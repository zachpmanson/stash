import { Button } from "./components/controls.js";
import React, { useEffect, useState } from "react";
import { CompactDialog } from "./CompactDialog.js";
import { Spinner } from "./Spinner.js";
import { request } from "./items.js";

/** Accept only the server's truthful, clean canonical URL for this exact folder. */
export function folderFeedUrl(value: unknown, id: string): string {
  const data = value as { version?: unknown; enabled?: unknown; url?: unknown; backend?: unknown; policy?: unknown } | null;
  if (!data || data.enabled !== true) throw new Error("The Atom feed is not available for this folder.");
  if (data.policy !== "always-on") throw new Error("This backend does not support always-on Atom feeds yet.");
  if (data.version !== 1 || typeof data.url !== "string" || typeof data.backend !== "string") throw new Error("Invalid Atom feed response.");
  let origin: URL;
  try { origin = new URL(data.backend); } catch { throw new Error("Invalid Atom feed URL."); }
  if (origin.protocol !== "https:" || origin.username || origin.password || data.backend !== origin.origin ||
      data.url !== `${origin.origin}/feeds/folders/${encodeURIComponent(id)}.atom`) throw new Error("Invalid Atom feed URL.");
  return data.url;
}

export function FolderFeedDialog({ id, name, returnFocus, onClose }: {
  id: string;
  name: string;
  returnFocus: HTMLElement | null;
  onClose: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    setCopied(false);
    setUrl("");
    void request<unknown>(`/folders/${encodeURIComponent(id)}/feed`).then((data) => {
      const clean = folderFeedUrl(data, id);
      if (live) setUrl(clean);
    }).catch((cause) => { if (live) setError(cause instanceof Error ? cause.message : "Could not load Atom feed."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [id, attempt]);
  return <CompactDialog title={`Atom feed · ${name}`} id="folder-feed-title" returnFocus={returnFocus} onCancel={onClose}>
    <p className="field-help">Private feed. Your feed reader must support HTTP Basic authentication. Enter your Stash credentials in the reader, never in this URL.</p>
    {loading && <p role="status" className="feed-status"><Spinner /> Loading feed…</p>}
    {error && <p role="alert">{error}</p>}
    {url && <label>Atom feed URL<input name="feed-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} /></label>}
    <div className="dialog-actions">
      {url && <Button disabled={copying} onClick={async () => {
        setCopying(true);
        setCopied(false);
        setError("");
        try { await navigator.clipboard.writeText(url); setCopied(true); }
        catch { setError("Could not copy. Select the URL and copy it manually."); }
        finally { setCopying(false); }
      }}>{copying ? <><Spinner /> Copying…</> : "Copy URL"}</Button>}
      {!loading && !url && <Button onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}
      <Button autoFocus onClick={onClose}>Close</Button>
    </div>
    <p role="status" aria-live="polite" className="dialog-copy-status">{copied ? "Copied URL." : ""}</p>
  </CompactDialog>;
}
