import React, { useState } from "react";

import type { WebItem as Item } from "../src/contracts.js";
export class ApiResponseError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiResponseError";
  }
}
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
    throw new ApiResponseError(
      response.status,
      typeof data?.error === "string"
        ? data.error
        : "Could not reach Stash. Check your connection and retry.",
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
export function ItemReader({
  item,
  actions,
}: {
  item: Item;
  actions?: React.ReactNode;
}) {
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
      {actions}
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
export function ItemEditor({
  item,
  busy,
  onSave,
  onCancel,
  onDirty,
}: {
  item: Item | null;
  busy: boolean;
  onSave: (data: Record<string, string>) => void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  // Freeze the editor's observed baseline; refreshes must not turn untouched
  // fields into writes that overwrite concurrent edits from another device.
  const [initial] = useState(() =>
    item ? { title: item.title ?? "", content: item.content ?? "" } : null,
  );
  return (
    <form
      onChange={(event) => {
        const values = new FormData(event.currentTarget);
        onDirty?.(
          !initial ||
            ["title", "content"].some(
              (key) => values.get(key) !== initial[key as keyof typeof initial],
            ),
        );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const changes = Object.fromEntries(values) as Record<string, string>;
        if (initial)
          for (const key of ["title", "content"] as const) {
            if (changes[key] === initial[key]) delete changes[key];
          }
        onSave(changes);
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
            autoFocus
            maxLength={500}
            defaultValue={initial?.title ?? ""}
          />
        </label>
        <label>
          Content (text or http(s) link)
          <textarea
            required
            name="content"
            maxLength={item?.type === "url" ? 4096 : 48000}
            rows={10}
            defaultValue={initial?.content ?? ""}
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
