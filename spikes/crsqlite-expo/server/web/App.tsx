import { Button } from "./components/controls.js";
import { AppHeader } from "./components/AppHeader.js";
import { FolderSidebar } from "./components/FolderSidebar.js";
import { ItemCollection } from "./components/ItemCollection.js";
import { ReaderPane } from "./components/ReaderPane.js";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  useWebRoute,
  readRoute,
  routeUrl,
  type Route,
} from "./hooks/useWebRoute.js";
import { useLayoutPreference } from "./hooks/useLayoutPreference.js";
export { readRoute, routeUrl } from "./hooks/useWebRoute.js";
import type {
  WebFolder as Folder,
  WebItem as Item,
  WebItemPage,
} from "../src/contracts.js";
import { ApiResponseError, request, uploadImage } from "./items.js";
import { FolderDialog } from "./FolderDialog.js";
import { FolderMenu, type FolderMenuTarget } from "./FolderMenu.js";
import { FolderFeedDialog } from "./FolderFeedDialog.js";
import { Spinner } from "./Spinner.js";
export {
  ApiResponseError,
  ItemEditor,
  ItemReader,
  request,
  safeLink,
} from "./items.js";

export function App() {
  const { route, setRoute, writeRoute } = useWebRoute();
  const { folderId, archived, selected, offset } = route;
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  // Retained cards after a failed refresh still belong to their last successful query.
  const [loadedPage, setLoadedPage] = useState<Pick<
    Route,
    "folderId" | "archived" | "offset"
  > | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const mutationInFlight = useRef(false);
  const [notice, setNotice] = useState("");
  const [allLayout, setAllLayout] = useLayoutPreference();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [folderAction, setFolderAction] = useState<"new" | null>(null);
  const newFolderTrigger = useRef<HTMLElement | null>(null);
  const creatingFolder = useRef(false);
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    name: string;
    archived: boolean;
    trigger: HTMLElement;
  } | null>(null);
  const [feedTarget, setFeedTarget] = useState<{
    id: string;
    trigger: HTMLElement;
  } | null>(null);
  const feedFolder = folders.find(
    (f) => f.id === feedTarget?.id && f.archived_at === null,
  );
  const [menuTarget, setMenuTarget] = useState<FolderMenuTarget | null>(null);
  const menuFolder = folders.find((f) => f.id === menuTarget?.id);
  function closeMenu() {
    if (menuTarget?.trigger.isConnected)
      menuTarget.trigger.focus({ preventScroll: true });
    setMenuTarget(null);
  }
  function closeRename() {
    if (busy || !discard()) return;
    dirty.current = false;
    setRenameTarget(null);
  }
  const [undo, setUndo] = useState<{ id: string; archived: boolean } | null>(
    null,
  );
  const dirty = useRef(false);
  const sequence = useRef(0);
  const readerRef = useRef<HTMLElement>(null);
  const folderButton = useRef<HTMLButtonElement>(null);
  const lastItemButton = useRef<HTMLButtonElement | null>(null);
  const editorReturnFocus = useRef<HTMLElement | null>(null);
  const membershipCount = folders.filter((f) =>
    detail?.folderIds.includes(f.id),
  ).length;
  const activeFolder = folders.find((f) => f.id === folderId);
  const layout = activeFolder
    ? activeFolder.layout === "grid"
      ? "grid"
      : "list"
    : allLayout;
  const discard = () =>
    !dirty.current || window.confirm("Discard unsaved changes?");
  function navigate(change: Partial<Route>) {
    if (busy || !discard()) return;
    dirty.current = false;
    setEditor(null);
    const next = { ...route, ...change };
    if (
      next.selected !== selected ||
      next.folderId !== folderId ||
      next.archived !== archived
    )
      setDetail(null);
    else if (selected) readerRef.current?.focus({ preventScroll: true });
    setSidebarOpen(false);
    setFolderAction(null);
    setRenameTarget(null);
    setMenuTarget(null);
    setFeedTarget(null);
    writeRoute(next);
  }
  const refresh = useCallback(async () => {
    const token = ++sequence.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({
        archived: String(archived),
        offset: String(offset),
        ...(folderId ? { folderId } : {}),
      });
      const [nextFolders, nextItems, nextDetail] = await Promise.all([
        request<Folder[]>("/folders"),
        request<WebItemPage>(`/items?${query}`),
        selected
          ? request<Item>(`/items/${encodeURIComponent(selected)}`).catch(
              (cause) => {
                if (cause instanceof ApiResponseError && cause.status === 404)
                  return null;
                throw cause;
              },
            )
          : Promise.resolve(null),
      ]);
      if (sequence.current !== token) return;
      const missingFolder =
        folderId !== "" && !nextFolders.some((f) => f.id === folderId);
      const incompatible =
        !!selected &&
        (!nextDetail ||
          (nextDetail.archived_at !== null) !== archived ||
          (!!folderId && !nextDetail.folderIds.includes(folderId)));
      setFolders(nextFolders);
      setFeedTarget((current) =>
        current &&
        nextFolders.some((f) => f.id === current.id && f.archived_at === null)
          ? current
          : null,
      );
      setMenuTarget((current) =>
        current && nextFolders.some((f) => f.id === current.id)
          ? current
          : null,
      );
      setRenameTarget((current) => {
        if (
          current &&
          !nextFolders.some(
            (f) =>
              f.id === current.id &&
              (f.archived_at !== null) === current.archived,
          )
        ) {
          dirty.current = false;
          return null;
        }
        return current;
      });
      setItems(nextItems.items);
      setLoadedPage({ folderId, archived, offset });
      setHasMore(nextItems.hasMore);
      setDetail(missingFolder || incompatible ? null : nextDetail);
      if (missingFolder || incompatible) {
        const next = {
          ...route,
          ...(missingFolder ? { folderId: "", offset: 0 } : {}),
          selected: "",
        };
        window.history?.replaceState(null, "", routeUrl(next));
        setRoute(next);
        setEditor((current) => {
          if (current === "edit") {
            dirty.current = false;
            return null;
          }
          return current;
        });
        setNotice(
          missingFolder
            ? "Folder removed; showing all items."
            : "That item is no longer available in this view.",
        );
      }
      setError("");
    } catch (cause) {
      if (sequence.current === token)
        setError(cause instanceof Error ? cause.message : "Refresh failed");
    } finally {
      if (sequence.current === token) setLoading(false);
    }
  }, [folderId, archived, offset, selected]);
  useEffect(() => {
    void refresh();
    return () => {
      sequence.current++;
    };
  }, [refresh]);
  useEffect(() => {
    const onFocus = () => {
      if (!editor && !busy) void refresh();
    };
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(() => {
      if (!document.hidden) onFocus();
    }, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refresh, editor, busy]);
  useEffect(() => {
    const pop = () => {
      if (busy || !discard()) {
        window.history?.pushState(null, "", routeUrl(route));
        return;
      }
      dirty.current = false;
      setEditor(null);
      setFolderAction(null);
      setRenameTarget(null);
      setMenuTarget(null);
      setFeedTarget(null);
      const next = readRoute();
      if (
        next.selected !== selected ||
        next.folderId !== folderId ||
        next.archived !== archived
      )
        setDetail(null);
      setRoute(next);
      setSidebarOpen(false);
    };
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("popstate", pop);
    window.addEventListener("beforeunload", unload);
    return () => {
      window.removeEventListener("popstate", pop);
      window.removeEventListener("beforeunload", unload);
    };
  }, [route, busy]);
  useEffect(() => {
    if (detail && !editor && readerRef.current) {
      readerRef.current.scrollTop = 0;
      readerRef.current.focus({ preventScroll: true });
    }
  }, [detail?.id]);
  useEffect(() => {
    if (sidebarOpen)
      document.querySelector<HTMLElement>(".folder-link")?.focus();
  }, [sidebarOpen]);
  async function mutate<T>(
    action: () => Promise<T>,
    after?: (result: T) => void,
  ) {
    if (mutationInFlight.current) return;
    mutationInFlight.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await action();
      setNotice("Saved.");
      await refresh();
      after?.(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Save failed");
    } finally {
      mutationInFlight.current = false;
      setBusy(false);
    }
  }
  function closeReader() {
    if (busy || !discard()) return;
    dirty.current = false;
    setEditor(null);
    setFolderAction(null);
    setRenameTarget(null);
    setMenuTarget(null);
    setDetail(null);
    writeRoute({ ...route, selected: "" });
    const target =
      [
        ...(document.querySelectorAll?.<HTMLButtonElement>("[data-item-id]") ??
          []),
      ].find((button) => button.dataset.itemId === selected) ??
      lastItemButton.current;
    window.setTimeout?.(() => target?.focus({ preventScroll: true }), 0);
  }
  function cancelEditor() {
    if (busy || !discard()) return;
    dirty.current = false;
    setEditor(null);
    window.setTimeout?.(() => {
      const target = selected
        ? document.querySelector<HTMLElement>('[aria-label="Edit item"]')
        : editorReturnFocus.current;
      target?.focus();
    }, 0);
  }
  function startNew() {
    if (!discard()) return;
    editorReturnFocus.current = document.activeElement as HTMLElement;
    dirty.current = false;
    setFolderAction(null);
    setRenameTarget(null);
    setMenuTarget(null);
    setEditor("new");
    setDetail(null);
    writeRoute({ ...route, selected: "" });
  }
  function openFolderForm(next: "new" | null, trigger?: HTMLElement) {
    if (busy || creatingFolder.current || !discard()) return;
    if (next) newFolderTrigger.current = trigger ?? null;
    dirty.current = false;
    setError("");
    setEditor(null);
    setRenameTarget(null);
    setMenuTarget(null);
    setFeedTarget(null);
    setFolderAction(next);
  }
  function changeLayout(next: "list" | "grid") {
    if (layout === next) return;
    if (activeFolder)
      void mutate(() =>
        request(`/folders/${encodeURIComponent(activeFolder.id)}`, "PATCH", {
          layout: next,
        }),
      );
    else {
      setAllLayout(next);
    }
  }
  const readerOpen = !!selected || !!editor;
  return (
    <div
      className="shell"
      onKeyDown={(e) => {
        if (
          e.key === "Tab" &&
          sidebarOpen &&
          !renameTarget &&
          !folderAction &&
          !menuTarget &&
          !feedTarget
        ) {
          const controls = [
            ...(document.querySelectorAll<HTMLElement>(
              ".sidebar button:not(:disabled), .sidebar input:not(:disabled)",
            ) ?? []),
          ];
          const first = controls[0],
            last = controls.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
          return;
        }
        if (e.key !== "Escape") return;
        if (sidebarOpen) {
          setSidebarOpen(false);
          folderButton.current?.focus();
        } else if (folderAction) {
          openFolderForm(null);
          folderButton.current?.focus();
        } else if (editor) cancelEditor();
        else if (readerOpen) closeReader();
      }}
    >
      <AppHeader
        sidebarOpen={sidebarOpen}
        folderButton={folderButton}
        archived={archived}
        busy={busy}
        loading={loading}
        onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
        onToggleArchive={() =>
          navigate({ archived: !archived, selected: "", offset: 0 })
        }
        onRefresh={() => void refresh()}
        onNew={startNew}
      />
      <div className="feedback px-4" role="status" aria-live="polite">
        {(busy || loading) && <Spinner />}
        {busy
          ? "Saving…"
          : loading
            ? items.length
              ? "Refreshing…"
              : "Loading…"
            : notice}
        {undo && (
          <Button
            disabled={busy}
            onClick={() =>
              void mutate(
                () =>
                  request(`/items/${encodeURIComponent(undo.id)}`, "PATCH", {
                    archived: undo.archived,
                  }),
                () => {
                  setUndo(null);
                },
              )
            }
          >
            Undo
          </Button>
        )}
      </div>
      {error && !renameTarget && !folderAction && (
        <div role="alert" className="error px-4">
          {error}{" "}
          <Button disabled={loading || busy} onClick={() => void refresh()}>
            Retry
          </Button>
        </div>
      )}
      <div className={`workspace ${readerOpen ? "reader-open" : ""}`}>
        {sidebarOpen && (
          <Button
            className="sidebar-shade"
            aria-label="Close folders"
            onClick={() => {
              setSidebarOpen(false);
              folderButton.current?.focus();
            }}
          />
        )}
        <FolderSidebar
          sidebarOpen={sidebarOpen}
          folders={folders}
          selected={folderId}
          archived={archived}
          busy={busy}
          onClose={() => {
            setSidebarOpen(false);
            folderButton.current?.focus();
          }}
          onMenu={(id, trigger, point) => {
            if (busy) return;
            const box = trigger.getBoundingClientRect();
            setMenuTarget({
              id,
              trigger,
              x: point?.x ?? box.left,
              y: point?.y ?? box.bottom,
            });
          }}
          onSelect={(id) => navigate({ folderId: id, offset: 0, selected: "" })}
          onNew={(trigger) => openFolderForm("new", trigger)}
        />
        <ItemCollection
          folderName={activeFolder?.name}
          folderId={folderId}
          archived={archived}
          selected={selected}
          offset={offset}
          items={items}
          loadedPage={loadedPage}
          hasMore={hasMore}
          loading={loading}
          busy={busy}
          layout={layout}
          onLayout={changeLayout}
          onUnarchive={() =>
            navigate({ archived: false, selected: "", offset: 0 })
          }
          onNew={startNew}
          onSelect={(id) => {
            if (busy) return;
            lastItemButton.current =
              [
                ...(document.querySelectorAll?.<HTMLButtonElement>(
                  "[data-item-id]",
                ) ?? []),
              ].find((button) => button.dataset.itemId === id) ?? null;
            navigate({ selected: id });
          }}
          onPage={(offset) => navigate({ offset, selected: "" })}
        />
        <ReaderPane
          readerRef={readerRef}
          readerOpen={readerOpen}
          selected={selected}
          editor={editor}
          detail={detail}
          busy={busy}
          loading={loading}
          folders={folders}
          membershipCount={membershipCount}
          onClose={closeReader}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onCancel={cancelEditor}
          onSave={(data, image) => {
            if (editor === "edit" && !Object.keys(data).length) {
              dirty.current = false;
              setEditor(null);
              return;
            }
            void mutate(
              async () => {
                if (editor === "new" && image) {
                  await uploadImage(image);
                  return request<{ id: string }>(`/media/uploads/${encodeURIComponent(image.id)}/finalize`, "POST", {
                    title: data.title || null, ...(folderId ? { folderId } : {}),
                  });
                }
                return request<{ id: string }>(
                  editor === "new"
                    ? "/items"
                    : `/items/${encodeURIComponent(selected)}`,
                  editor === "new" ? "POST" : "PATCH",
                  {
                    ...data,
                    ...(editor === "new" && folderId ? { folderId } : {}),
                  },
                );
              },
              (result) => {
                dirty.current = false;
                setEditor(null);
                writeRoute({
                  ...route,
                  selected: result.id,
                  offset: editor === "new" ? 0 : offset,
                });
              },
            );
          }}
          onEdit={() => {
            if (!discard()) return;
            dirty.current = false;
            setFolderAction(null);
            setRenameTarget(null);
            setMenuTarget(null);
            setEditor("edit");
          }}
          onArchive={() => {
            if (!detail) return;
            const index = items.findIndex((i) => i.id === detail.id);
            const next = items[index + 1] ?? items[index - 1];
            void mutate(
              () =>
                request(`/items/${encodeURIComponent(detail.id)}`, "PATCH", {
                  archived: detail.archived_at === null,
                }),
              () => {
                setUndo({
                  id: detail.id,
                  archived: detail.archived_at !== null,
                });
                writeRoute({
                  ...route,
                  selected: next?.id ?? "",
                });
                setNotice(
                  detail.archived_at === null
                    ? "Item archived."
                    : "Item restored.",
                );
              },
            );
          }}
          onMembership={(id, present) => {
            if (!detail) return;
            void mutate(() =>
              request(
                `/items/${encodeURIComponent(detail.id)}/folders/${encodeURIComponent(id)}`,
                "PUT",
                { present },
              ),
            );
          }}
        />
      </div>
      {folderAction === "new" && (
        <FolderDialog
          key="new"
          name={null}
          busy={busy}
          error={error}
          returnFocus={newFolderTrigger.current}
          onCancel={() => openFolderForm(null)}
          onDirty={(value) => { dirty.current = value; }}
          onSave={(name) => {
            if (busy || creatingFolder.current || name === null) return;
            creatingFolder.current = true;
            void mutate(
              () => request<{ id: string }>("/folders", "POST", { name }),
              (result) => {
                dirty.current = false;
                setFolderAction(null);
                setSidebarOpen(false);
                setEditor(null);
                setDetail(null);
                writeRoute({ ...route, folderId: result.id, selected: "", offset: 0 });
              },
            ).finally(() => { creatingFolder.current = false; });
          }}
        />
      )}
      {menuTarget && menuFolder && (
        <FolderMenu
          target={menuTarget}
          folder={menuFolder}
          busy={busy}
          onClose={closeMenu}
          onFeed={() => {
            if (busy || menuFolder.archived_at !== null) return;
            // Viewing a URL is not consent to discard any underlying draft.
            setFeedTarget({ id: menuFolder.id, trigger: menuTarget.trigger });
            setMenuTarget(null);
          }}
          onRename={() => {
            if (busy || !discard()) return;
            dirty.current = false;
            setEditor(null);
            setFolderAction(null);
            setRenameTarget({
              id: menuFolder.id,
              name: menuFolder.name,
              archived: menuFolder.archived_at !== null,
              trigger: menuTarget.trigger,
            });
            setMenuTarget(null);
          }}
          onArchive={() => {
            if (busy || !discard()) return;
            // A discarded editor must not remain mounted with a stale dirty flag.
            dirty.current = false;
            setEditor(null);
            setFolderAction(null);
            closeMenu();
            void mutate(() =>
              request(
                `/folders/${encodeURIComponent(menuFolder.id)}`,
                "PATCH",
                {
                  archived: menuFolder.archived_at === null,
                },
              ),
            );
          }}
        />
      )}
      {feedTarget && feedFolder && (
        <FolderFeedDialog
          key={feedTarget.id}
          id={feedFolder.id}
          name={feedFolder.name}
          returnFocus={feedTarget.trigger}
          onClose={() => setFeedTarget(null)}
        />
      )}
      {renameTarget && (
        <FolderDialog
          key={renameTarget.id}
          name={renameTarget.name}
          busy={busy}
          error={error}
          returnFocus={renameTarget.trigger}
          onCancel={closeRename}
          onDirty={(value) => {
            dirty.current = value;
          }}
          onSave={(name) => {
            if (
              busy ||
              !folders.some(
                (f) =>
                  f.id === renameTarget.id &&
                  (f.archived_at !== null) === renameTarget.archived,
              )
            )
              return;
            if (name === null) {
              dirty.current = false;
              setRenameTarget(null);
              return;
            }
            void mutate(
              () =>
                request(
                  `/folders/${encodeURIComponent(renameTarget.id)}`,
                  "PATCH",
                  { name },
                ),
              () => {
                dirty.current = false;
                setRenameTarget(null);
              },
            );
          }}
        />
      )}
    </div>
  );
}
