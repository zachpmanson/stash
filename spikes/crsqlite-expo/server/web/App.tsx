import React, { useCallback, useEffect, useRef, useState } from "react";
import type {
  WebFolder as Folder,
  WebItem as Item,
  WebItemPage,
} from "../src/contracts.js";
import { ApiResponseError, ItemEditor, ItemReader, request } from "./items.js";
import { FolderNavigation, Icon, ItemCard } from "./components.js";
import { FolderForm } from "./FolderForm.js";
export {
  ApiResponseError,
  ItemEditor,
  ItemReader,
  request,
  safeLink,
} from "./items.js";

type Route = {
  folderId: string;
  archived: boolean;
  selected: string;
  offset: number;
};
export function readRoute(): Route {
  const q = new URLSearchParams(window.location?.search ?? "");
  return {
    folderId: q.get("folder") ?? "",
    archived: q.get("archive") === "1",
    selected: q.get("item") ?? "",
    offset: Math.trunc(
      Math.max(0, Math.min(99999900, Number(q.get("offset")) || 0)),
    ),
  };
}
export function routeUrl(route: Route) {
  const q = new URLSearchParams();
  if (route.folderId) q.set("folder", route.folderId);
  if (route.archived) q.set("archive", "1");
  if (route.selected) q.set("item", route.selected);
  if (route.offset) q.set("offset", String(route.offset));
  return `${window.location?.pathname ?? "/"}${q.size ? `?${q}` : ""}`;
}
function localLayout(): "grid" | "list" {
  try {
    return window.localStorage.getItem("stash.all.layout") === "grid"
      ? "grid"
      : "list";
  } catch {
    return "list";
  }
}
export function App() {
  const [route, setRoute] = useState(readRoute);
  const { folderId, archived, selected, offset } = route;
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  // Retained cards after a failed refresh still belong to their last successful query.
  const [loadedPage, setLoadedPage] = useState<
    Pick<Route, "folderId" | "archived" | "offset"> | null
  >(null);
  const [hasMore, setHasMore] = useState(false);
  const [detail, setDetail] = useState<Item | null>(null);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [allLayout, setAllLayout] = useState(localLayout);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [folderAction, setFolderAction] = useState<"new" | "rename" | null>(
    null,
  );
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
  function writeRoute(next: Route, replace = false) {
    const url = routeUrl(next);
    if (
      replace ||
      `${window.location?.pathname ?? "/"}${window.location?.search ?? ""}` !==
        url
    )
      window.history?.[replace ? "replaceState" : "pushState"](null, "", url);
    setRoute(next);
  }
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
        if (missingFolder)
          setFolderAction((current) => {
            if (current === "rename") {
              dirty.current = false;
              return null;
            }
            return current;
          });
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
      setBusy(false);
    }
  }
  function closeReader() {
    if (busy || !discard()) return;
    dirty.current = false;
    setEditor(null);
    setFolderAction(null);
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
    setEditor("new");
    setDetail(null);
    writeRoute({ ...route, selected: "" });
  }
  function openFolderForm(next: "new" | "rename" | null) {
    if (!discard()) return;
    dirty.current = false;
    setEditor(null);
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
      try {
        window.localStorage.setItem("stash.all.layout", next);
      } catch {
        /* Storage may be disabled. */
      }
    }
  }
  const folderPath = `/folders/${encodeURIComponent(folderId)}`;
  const readerOpen = !!selected || !!editor;
  return (
    <div
      className="shell"
      onKeyDown={(e) => {
        if (e.key === "Tab" && sidebarOpen) {
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
      <header className="app-header flex items-center gap-3 px-3 md:px-4">
        <button
          className="sidebar-toggle"
          aria-label="Open folders"
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
          ref={folderButton}
        >
          <Icon name="menu" />
        </button>
        <h1 className="text-xl font-semibold tracking-tight">
          Stash<span className="brand-dot">.</span>
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <button
            aria-label="Archive"
            aria-pressed={archived}
            disabled={busy}
            onClick={() =>
              navigate({ archived: !archived, selected: "", offset: 0 })
            }
          >
            <Icon name="archive" />
            <span className="hidden min-[381px]:inline">Archive</span>
          </button>
          <button
            aria-label="Refresh"
            disabled={loading || busy}
            onClick={() => void refresh()}
          >
            <Icon name="refresh" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          {!archived && (
            <button
              className="primary"
              aria-label="New item"
              disabled={busy}
              onClick={startNew}
            >
              <Icon name="plus" />
              New item
            </button>
          )}
        </div>
      </header>
      <div className="feedback px-4" role="status" aria-live="polite">
        {busy
          ? "Saving…"
          : loading
            ? items.length
              ? "Refreshing…"
              : "Loading…"
            : notice}
        {undo && (
          <button
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
          </button>
        )}
      </div>
      {error && (
        <div role="alert" className="error px-4">
          {error}{" "}
          <button disabled={loading || busy} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      <div className={`workspace ${readerOpen ? "reader-open" : ""}`}>
        {sidebarOpen && (
          <button
            className="sidebar-shade"
            aria-label="Close folders"
            onClick={() => {
              setSidebarOpen(false);
              folderButton.current?.focus();
            }}
          />
        )}
        <aside
          className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
          aria-label="Library filters"
        >
          <div className="sidebar-heading">
            <h2 className="nav-label">Library</h2>
            <button
              className="sidebar-toggle"
              aria-label="Close folders"
              onClick={() => {
                setSidebarOpen(false);
                folderButton.current?.focus();
              }}
            >
              <Icon name="back" />
            </button>
          </div>
          <FolderNavigation
            folders={folders}
            selected={folderId}
            archived={archived}
            onSelect={(id) =>
              navigate({ folderId: id, offset: 0, selected: "" })
            }
          />
          {!archived && (
            <button
              className="new-folder"
              disabled={busy}
              onClick={() =>
                openFolderForm(folderAction === "new" ? null : "new")
              }
            >
              <Icon name="plus" />
              New folder
            </button>
          )}
          {activeFolder && (
            <div
              className="folder-actions mt-2 pt-2 border-t border-line flex flex-wrap gap-2"
              aria-label="Folder actions"
            >
              <button
                disabled={busy}
                onClick={() =>
                  openFolderForm(folderAction === "rename" ? null : "rename")
                }
              >
                <Icon name="edit" />
                Rename
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  if (discard())
                    void mutate(() =>
                      request(folderPath, "PATCH", {
                        archived: activeFolder.archived_at === null,
                      }),
                    );
                }}
              >
                {activeFolder.archived_at === null
                  ? "Archive folder"
                  : "Unarchive folder"}
              </button>
            </div>
          )}
          {folderAction && (
            <FolderForm
              key={folderAction === "new" ? "new" : `rename-${folderId}`}
              initialName={
                folderAction === "new" ? null : (activeFolder?.name ?? "")
              }
              busy={busy}
              onDirty={(value) => {
                dirty.current = value;
              }}
              onCancel={() => openFolderForm(null)}
              onSave={(name) => {
                if (name === null) {
                  dirty.current = false;
                  setFolderAction(null);
                  return;
                }
                void mutate(
                  () =>
                    request<{ id: string }>(
                      folderAction === "new" ? "/folders" : folderPath,
                      folderAction === "new" ? "POST" : "PATCH",
                      { name },
                    ),
                  (result) => {
                    dirty.current = false;
                    setFolderAction(null);
                    if (folderAction === "new") {
                      setSidebarOpen(false);
                      setEditor(null);
                      setDetail(null);
                      writeRoute({
                        ...route,
                        folderId: result.id,
                        selected: "",
                        offset: 0,
                      });
                    }
                  },
                );
              }}
            />
          )}
        </aside>
        <main className="collection" aria-label="Items" aria-busy={loading}>
          <div className="collection-heading">
            <h2 title={activeFolder?.name || (archived ? "Archived items" : "All items")}>
              {activeFolder?.name || (archived ? "Archived items" : "All items")}
              {archived && <span className="sr-only"> · Archived items only</span>}
            </h2>
            <div
              className="layout-toggle ml-auto"
              role="group"
              aria-label="Collection layout"
            >
              <button
                title="List layout"
                aria-label="List layout"
                aria-pressed={layout === "list"}
                disabled={busy}
                onClick={() => changeLayout("list")}
              >
                <Icon name="list" />
              </button>
              <button
                title="Grid layout"
                aria-label="Grid layout"
                aria-pressed={layout === "grid"}
                disabled={busy}
                onClick={() => changeLayout("grid")}
              >
                <Icon name="grid" />
              </button>
            </div>
          </div>
          {!loading && !items.length && (
            <div className="empty">
              <Icon name={archived ? "archive" : "folder"} />
              <h3>
                {archived
                  ? "Nothing archived here"
                  : "No items yet"}
              </h3>
              <p>
                {archived
                  ? "Archived items will appear here."
                  : "Add a text or link to start this collection."}
              </p>
              <button
                disabled={busy}
                onClick={() =>
                  archived
                    ? navigate({ archived: false, selected: "", offset: 0 })
                    : startNew()
                }
              >
                {archived ? "Back to collection" : "New item"}
              </button>
            </div>
          )}
          <ul
            className={`items ${layout === "grid" ? "grid grid-cols-2 gap-2" : "flex flex-col"}`}
            onFocusCapture={(event) => {
              // Native focus scrolling does not account for the sticky heading.
              const pane = event.currentTarget.parentElement!;
              const heading = pane.querySelector(".collection-heading")!;
              const overlap =
                heading.getBoundingClientRect().bottom + 6 -
                event.target.getBoundingClientRect().top;
              if (overlap > 0) pane.scrollTop -= overlap;
            }}
          >
            {items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                selected={selected === item.id}
                onSelect={() => {
                  if (busy) return;
                  lastItemButton.current =
                    [
                      ...(document.querySelectorAll?.<HTMLButtonElement>(
                        "[data-item-id]",
                      ) ?? []),
                    ].find((button) => button.dataset.itemId === item.id) ??
                    null;
                  navigate({ selected: item.id });
                }}
                onKeyDown={(e) => {
                  if (
                    [
                      "ArrowDown",
                      "ArrowUp",
                      "ArrowRight",
                      "ArrowLeft",
                    ].includes(e.key)
                  ) {
                    e.preventDefault();
                    const buttons = [
                      ...e.currentTarget
                        .closest("ul")!
                        .querySelectorAll<HTMLButtonElement>("button"),
                    ];
                    const delta =
                      e.key === "ArrowUp"
                        ? layout === "grid"
                          ? -2
                          : -1
                        : e.key === "ArrowDown"
                          ? layout === "grid"
                            ? 2
                            : 1
                          : e.key === "ArrowLeft"
                            ? -1
                            : 1;
                    buttons[
                      Math.max(
                        0,
                        Math.min(
                          buttons.length - 1,
                          buttons.indexOf(e.currentTarget) + delta,
                        ),
                      )
                    ]?.focus();
                  }
                }}
              />
            ))}
          </ul>
          {(offset > 0 || hasMore) && (
            <nav aria-label="Item pages" className="actions mt-6">
              {!loading &&
                items.length > 0 &&
                loadedPage?.folderId === folderId &&
                loadedPage.archived === archived &&
                loadedPage.offset === offset && (
                  <span className="text-muted text-sm">
                    Items {offset + 1}–{offset + items.length}
                  </span>
                )}
              <button
                disabled={!offset || loading || busy}
                onClick={() =>
                  navigate({ offset: Math.max(0, offset - 100), selected: "" })
                }
              >
                Previous
              </button>
              <button
                disabled={!hasMore || loading || busy}
                onClick={() => navigate({ offset: offset + 100, selected: "" })}
              >
                Next
              </button>
            </nav>
          )}
        </main>
        <section
          className="reader"
          aria-label="Selected item"
          tabIndex={-1}
          ref={readerRef}
        >
          {readerOpen && (
            <button
              className="back-button mb-3"
              disabled={busy}
              onClick={closeReader}
            >
              <Icon name="back" />
              Back to collection
            </button>
          )}
          {editor ? (
            <ItemEditor
              key={editor === "new" ? "new" : selected}
              item={editor === "edit" ? detail : null}
              busy={busy}
              onDirty={(value) => {
                dirty.current = value;
              }}
              onCancel={cancelEditor}
              onSave={(data) => {
                if (editor === "edit" && !Object.keys(data).length) {
                  dirty.current = false;
                  setEditor(null);
                  return;
                }
                void mutate(
                  () =>
                    request<{ id: string }>(
                      editor === "new"
                        ? "/items"
                        : `/items/${encodeURIComponent(selected)}`,
                      editor === "new" ? "POST" : "PATCH",
                      {
                        ...data,
                        ...(editor === "new" && folderId ? { folderId } : {}),
                      },
                    ),
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
            />
          ) : detail ? (
            <div className="reader-content">
              <p className="eyebrow">
                {detail.type === "url"
                  ? "Saved link"
                  : detail.type === "text"
                    ? "Note"
                    : "On your device"}
              </p>
              <ItemReader
                item={detail}
                actions={
                  !detail.mediaUnavailable && (
                    <div className="actions my-3">
                      <button
                        aria-label="Edit item"
                        disabled={busy}
                        onClick={() => {
                          if (!discard()) return;
                          dirty.current = false;
                          setFolderAction(null);
                          setEditor("edit");
                        }}
                      >
                        Edit item
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => {
                          const index = items.findIndex(
                            (i) => i.id === detail.id,
                          );
                          const next = items[index + 1] ?? items[index - 1];
                          void mutate(
                            () =>
                              request(
                                `/items/${encodeURIComponent(detail.id)}`,
                                "PATCH",
                                { archived: detail.archived_at === null },
                              ),
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
                      >
                        {detail.archived_at === null
                          ? "Archive item"
                          : "Unarchive item"}
                      </button>
                    </div>
                  )
                }
              />
              {!detail.mediaUnavailable && (
                <>
                  <details className="organise">
                    <summary>
                      <span className="sr-only">Folder membership: </span>
                      Organise · {membershipCount === 0
                        ? "No folders"
                        : `${membershipCount} ${membershipCount === 1 ? "folder" : "folders"}`}
                    </summary>
                    <fieldset disabled={busy}>
                      <legend className="sr-only">Folder membership</legend>
                      {folders.map((f) => (
                        <label className="check" key={f.id}>
                          <input
                            type="checkbox"
                            checked={detail.folderIds.includes(f.id)}
                            onChange={(e) =>
                              void mutate(() =>
                                request(
                                  `/items/${encodeURIComponent(detail.id)}/folders/${encodeURIComponent(f.id)}`,
                                  "PUT",
                                  { present: e.target.checked },
                                ),
                              )
                            }
                          />
                          {f.name}
                          {f.archived_at !== null ? " (archived)" : ""}
                        </label>
                      ))}
                      {!folders.length && (
                        <p>Create a folder to organize this item.</p>
                      )}
                    </fieldset>
                  </details>
                </>
              )}
            </div>
          ) : (
            <div className="reader-placeholder">
              <Icon name="text" />
              <h2>
                {selected && loading ? "Loading item…" : "No item selected"}
              </h2>
              <p>Choose an item to read it.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
