import { Button } from "./components/controls.js";
import React, { useId, useState, useRef } from "react";
import { uploadImage, type ImageUpload } from "./media.js";
export { uploadImage };

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
export function PrivateImage({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return failed ? <span role="status">Image unavailable. <Button type="button" onClick={() => { setAttempt(n => n + 1); setFailed(false); }}>Retry image</Button></span> :
    <img key={`${url}:${attempt}`} src={url} alt={alt} className={className} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}
export function ItemReader({
  item,
  actions,
}: {
  item: Item;
  actions?: React.ReactNode;
}) {
  const linkHintId = useId();
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
      {item.image?.state === "available" ? (
        <PrivateImage key={item.id} url={item.image.previewUrl} alt={item.title || "Saved image"} className="reader-image" />
      ) : item.image?.state === "pending" ? <p role="status">Image bytes pending. Connect the device with the original and check Settings → Sync for transfer/retry status.</p> : item.mediaUnavailable ? (
        <p>
          Media unavailable on the web. Open this item on a device that has the
          file.
        </p>
      ) : (
        <>
          {item.type === "url" ? (
            href ? (
              <p>
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-describedby={linkHintId}
                >
                  {href}
                </a>
                <span id={linkHintId} className="external-link-hint">
                  Opens in a new tab
                </span>
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
  onSave: (data: Record<string, string>, image?: ImageUpload) => void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
}) {
  const contentHelpId = useId();
  const [newType, setNewType] = useState("text");
  const [file, setFile] = useState<File | null>(null);
  const uploadId = useRef<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [imageError, setImageError] = useState("");
  const fields = item?.type === "image" ? ["title"] as const : ["title", "content"] as const;
  function chooseFile(files: FileList | File[]) {
    if (busy) return;
    if (files.length !== 1 || !files[0].size || files[0].size > 20 * 1024 * 1024) {
      setImageError("Choose one JPEG, PNG or still WebP image up to 20 MiB."); return;
    }
    setFile(files[0]); uploadId.current = crypto.randomUUID(); setImageError(""); setProgress(0); onDirty?.(true);
  }
  // Freeze the editor's observed baseline; refreshes must not turn untouched
  // fields into writes that overwrite concurrent edits from another device.
  const [initial] = useState(() =>
    item ? { title: item.title ?? "", content: item.content ?? "" } : null,
  );
  return (
    <form
      onDragOver={event => { if (!item && newType === "image") event.preventDefault(); }}
      onDrop={event => { if (!item && newType === "image") { event.preventDefault(); chooseFile(event.dataTransfer.files); } }}
      onPaste={event => { if (!item && newType === "image" && event.clipboardData.files.length) { event.preventDefault(); chooseFile(event.clipboardData.files); } }}
      onChange={(event) => {
        const values = new FormData(event.currentTarget);
        onDirty?.(
          !initial ||
            fields.some(
              (key) => values.get(key) !== initial[key as keyof typeof initial],
            ),
        );
      }}
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const changes = Object.fromEntries(values) as Record<string, string>;
        if (!item && newType === "image") {
          if (!file || !uploadId.current) { setImageError("Choose, drop or paste an image first."); return; }
          onSave({ type: "image", title: String(values.get("title") ?? "") }, { file, id: uploadId.current, onProgress: setProgress });
          return;
        }
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
            <select name="type" defaultValue="text" onChange={e => setNewType(e.target.value)}>
              <option value="text">Text</option>
              <option value="url">Link</option>
              <option value="image">Image</option>
            </select>
          </label>
        )}
        <label>
          Title (optional)
          <input
            name="title"
            autoFocus
            maxLength={500}
            defaultValue={initial?.title ?? ""}
          />
        </label>
        {!item && newType === "image" ? <div className="image-drop-zone" tabIndex={0}>
          <label>Image <input type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { if (e.target.files) chooseFile(e.target.files); }} /></label>
          <p>Choose, drop or paste one JPEG, PNG or still WebP image. Maximum 20 MiB, 24 megapixels and 12,000 pixels per edge. Animated images, HEIC, AVIF and SVG are not supported; your original is never modified.</p>
          {file && <p>{file.name} · {Math.ceil(file.size / 1024)} KiB</p>}
          {busy && <p role="status">{progress < 100 ? `Uploading image: ${progress}%` : "Bytes uploaded; validating and saving…"}</p>}
          {imageError && <p role="alert">{imageError}</p>}
        </div> : item?.type === "image" ? null : <><label>
          Content (required)
          <textarea
            required
            aria-describedby={contentHelpId}
            name="content"
            maxLength={item?.type === "url" ? 4096 : 48000}
            rows={6}
            defaultValue={initial?.content ?? ""}
          />
        </label>
        <p id={contentHelpId} className="field-help">
          Content is required. For links, paste a full http:// or https:// address.
        </p></>}
        <div className="actions">
          <Button type="submit" className="primary">
            {busy ? "Saving…" : "Save item"}
          </Button>
          <Button type="button" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
