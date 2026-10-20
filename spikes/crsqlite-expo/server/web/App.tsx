import React, { useCallback, useEffect, useRef, useState } from "react";

import type {
  WebFolder as Folder,
  WebItem as Item,
  WebItemPage,
} from "../src/contracts.js";
export async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    headers:
      method === "GET"
        ? {}
        : { "Content-Type": "application/json", "X-Stash-Request": "1" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    if (response.status === 401)
      throw new Error(
        "Authentication required. Reopen this page through the authenticated Stash address.",
      );
    const data = await response.json().catch(() => null);
    throw new Error(
      data?.error ?? "Could not reach Stash. Check your connection and retry.",
    );
  }
  return response.json();
}
export function safeLink(value: string | null): string | null {
  try {
    const url = new URL(value ?? "");
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function ItemReader({ item }: { item: Item }) {
  const href = item.type === "url" ? safeLink(item.content) : null;
  return (
    <>
      <h2>
        {item.title ||
          (item.type === "url"
            ? "Link"
            : item.type === "text"
              ? "Text"
              : "Media")}
      </h2>
      {item.mediaUnavailable ? (
        <p>
          Media unavailable on the web. Open this item on a device that has the
          file.
        </p>
      ) : (
        <>
          {item.type === "url" ? (
            href ? (
              <p>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {href}
                </a>
              </p>
            ) : (
              <p>This link is unavailable or unsafe to open.</p>
            )
          ) : (
            <p className="plaintext">{item.content}</p>
          )}
          {item.description && <p className="plaintext">{item.description}</p>}
          {item.article_text && (
            <section aria-label="Saved article">
              <h3>Saved article</h3>
              <p className="plaintext">{item.article_text}</p>
            </section>
          )}
        </>
      )}
    </>
  );
}
function ItemEditor({
  item,
  busy,
  onSave,
  onCancel,
}: {
  item: Item | null;
  busy: boolean;
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
}) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        onSave(Object.fromEntries(values) as Record<string, string>);
      }}
    >
      <h2>{item ? "Edit item" : "New item"}</h2>
      <fieldset disabled={busy}>
        {!item && (
          <label>
            Type
            <select name="type" defaultValue="text">
              <option value="text">Text</option>
              <option value="url">Link</option>
            </select>
          </label>
        )}
        <label>
          Title
          <input
            name="title"
            maxLength={500}
            defaultValue={item?.title ?? ""}
          />
        </label>
        <label>
          Content (text or http(s) link)
          <textarea
            required
            name="content"
            maxLength={item?.type === "url" ? 4096 : 48000}
            rows={10}
            defaultValue={item?.content ?? ""}
          />
        </label>
        <div className="actions">
          <button type="submit">Save item</button>
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </fieldset>
    </form>
  );
}
export function App() {
  const [folders, setFolders] = useState<Folder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [folderId, setFolderId] = useState("");
  const [archived, setArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Item | null>(null);
  const [editor, setEditor] = useState<"new" | "edit" | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
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
          ? request<Item>(`/items/${encodeURIComponent(selected)}`)
          : Promise.resolve(null),
      ]);
      if (sequence.current !== token) return;
      setFolders(nextFolders);
      setItems(nextItems.items);
      setHasMore(nextItems.hasMore);
      setDetail(nextDetail);
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
  const activeFolder = folders.find((folder) => folder.id === folderId);
  return (
    <div className="shell">
      <header>
        <h1>Stash</h1>
        <p>Your library, online. Media stays on your devices.</p>
        <button disabled={loading || busy} onClick={() => void refresh()}>
          Refresh
        </button>
      </header>
      {error && (
        <div role="alert">
          {error}{" "}
          <button disabled={loading || busy} onClick={() => void refresh()}>
            Retry
          </button>
        </div>
      )}
      <p role="status" aria-live="polite">
        {busy ? "Saving…" : loading ? "Loading…" : notice}
      </p>
      <div className="columns">
        <aside aria-label="Library filters">
          <label>
            Folder
            <select
              disabled={busy}
              value={folderId}
              onChange={(event) => {
                setFolderId(event.target.value);
                setOffset(0);
                setSelected("");
                setDetail(null);
                setEditor(null);
              }}
            >
              <option value="">All folders</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.icon} {folder.name}
                  {folder.archived_at !== null ? " (archived)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              disabled={busy}
              checked={archived}
              onChange={(event) => {
                setArchived(event.target.checked);
                setOffset(0);
                setSelected("");
                setDetail(null);
                setEditor(null);
              }}
            />
            Archived items
          </label>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const name = new FormData(form).get("name");
              void mutate(
                () => request("/folders", "POST", { name }),
                () => form.reset(),
              );
            }}
          >
            <label>
              New folder
              <input required name="name" maxLength={200} />
            </label>
            <button disabled={busy}>Create folder</button>
          </form>
          {activeFolder && (
            <section aria-label="Edit folder" key={activeFolder.id}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get("name");
                  void mutate(() =>
                    request(
                      `/folders/${encodeURIComponent(activeFolder.id)}`,
                      "PATCH",
                      { name },
                    ),
                  );
                }}
              >
                <label>
                  Folder name
                  <input
                    required
                    name="name"
                    maxLength={200}
                    defaultValue={activeFolder.name}
                  />
                </label>
                <button disabled={busy}>Rename folder</button>
              </form>
              <button
                disabled={busy}
                onClick={() =>
                  void mutate(() =>
                    request(
                      `/folders/${encodeURIComponent(activeFolder.id)}`,
                      "PATCH",
                      { archived: activeFolder.archived_at === null },
                    ),
                  )
                }
              >
                {activeFolder.archived_at === null
                  ? "Archive folder"
                  : "Unarchive folder"}
              </button>
            </section>
          )}
        </aside>
        <main>
          <section aria-label="Items" aria-busy={loading}>
            <div className="actions">
              <h2>{archived ? "Archived items" : "Items"}</h2>
              <button
                disabled={busy}
                onClick={() => {
                  setEditor("new");
                  setSelected("");
                  setDetail(null);
                }}
              >
                New item
              </button>
            </div>
            {!loading && items.length === 0 && <p>No items here yet.</p>}
            <ul className="items">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    aria-pressed={selected === item.id}
                    disabled={busy}
                    onClick={() => {
                      setSelected(item.id);
                      setDetail(null);
                      setEditor(null);
                    }}
                  >
                    {item.title ||
                      (item.type === "url"
                        ? "Link"
                        : item.type === "text"
                          ? "Untitled text"
                          : "Media unavailable")}{" "}
                    <small>{item.type}</small>
                  </button>
                </li>
              ))}
            </ul>
            <nav aria-label="Item pages" className="actions">
              <button
                disabled={offset === 0 || loading || busy}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous
              </button>
              <button
                disabled={!hasMore || loading || busy}
                onClick={() => setOffset(offset + 100)}
              >
                Next
              </button>
            </nav>
          </section>
          <section className="reader" aria-label="Selected item">
            {editor ? (
              <ItemEditor
                key={editor === "new" ? "new" : selected}
                item={editor === "edit" ? detail : null}
                busy={busy}
                onCancel={() => setEditor(null)}
                onSave={(data) =>
                  void mutate(
                    () =>
                      request<{ id: string }>(
                        editor === "new"
                          ? "/items"
                          : `/items/${encodeURIComponent(selected)}`,
                        editor === "new" ? "POST" : "PATCH",
                        data,
                      ),
                    (result) => {
                      setEditor(null);
                      setSelected(result.id);
                    },
                  )
                }
              />
            ) : detail ? (
              <>
                <ItemReader item={detail} />
                {!detail.mediaUnavailable && (
                  <>
                    <div className="actions">
                      <button disabled={busy} onClick={() => setEditor("edit")}>
                        Edit item
                      </button>
                      <button
                        disabled={busy}
                        onClick={() =>
                          void mutate(() =>
                            request(
                              `/items/${encodeURIComponent(detail.id)}`,
                              "PATCH",
                              { archived: detail.archived_at === null },
                            ),
                          )
                        }
                      >
                        {detail.archived_at === null
                          ? "Archive item"
                          : "Unarchive item"}
                      </button>
                    </div>
                    <fieldset disabled={busy}>
                      <legend>Folder membership</legend>
                      {folders.map((folder) => (
                        <label className="check" key={folder.id}>
                          <input
                            type="checkbox"
                            checked={detail.folderIds.includes(folder.id)}
                            onChange={(event) =>
                              void mutate(() =>
                                request(
                                  `/items/${encodeURIComponent(detail.id)}/folders/${encodeURIComponent(folder.id)}`,
                                  "PUT",
                                  { present: event.target.checked },
                                ),
                              )
                            }
                          />
                          {folder.name}
                          {folder.archived_at !== null ? " (archived)" : ""}
                        </label>
                      ))}
                      {folders.length === 0 && (
                        <p>Create a folder to organize this item.</p>
                      )}
                    </fieldset>
                  </>
                )}
              </>
            ) : (
              <p>
                {selected && loading
                  ? "Loading item…"
                  : "Choose an item to read it."}
              </p>
            )}
          </section>
        </main>
      </div>
    </div>
  );
}
