import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import type Database from "better-sqlite3";
import { Hono, type Context } from "hono";
import type { attachWebsocketServer } from "@vlcn.io/ws-server";
import { DATABASE_ROOM, SCHEMA_NAME } from "../schema.js";
import { MEDIA_MAX_BYTES, MediaError, receiveImage, commitManifest, manifest, mediaFile, type Manifest } from "./media-store.js";

type MediaItem = { id: string; type: string; media_id: string | null };
function requireImage(db: Database.Database, id: string): MediaItem {
  const row = db.prepare("SELECT id,type,media_id FROM sync_items WHERE id=?").get(id) as MediaItem | undefined;
  if (!row) throw new MediaError(404, "Item not found; sync metadata first");
  if (row.type !== "image" || row.media_id !== row.id)
    throw new MediaError(409, "Item does not have a supported image identity");
  return row;
}
function checkedId(value: string): string {
  if (!value || value.length > 200 || /[\0/\\]/.test(value) || value === "." || value === "..")
    throw new MediaError(400, "Invalid item ID");
  return value;
}
function secure(c: Context, user: string): Response | undefined {
  c.header("Cache-Control", "private, no-store");
  c.header("X-Content-Type-Options", "nosniff");
  if (c.req.header("X-Auth-User") !== user) return c.json({ error: "Unauthorized" }, 401);
  const read = c.req.method === "GET" || c.req.method === "HEAD";
  if ((!read && c.req.header("X-Stash-Request") !== "1") ||
    ![undefined, "same-origin", "none"].includes(c.req.header("Sec-Fetch-Site")))
    return c.json({ error: "Same-origin image request required" }, 403);
  const origin = c.req.header("Origin");
  if (origin) {
    try {
      const source = new URL(origin);
      const protocol = c.req.header("X-Forwarded-Proto") ?? "http";
      if (!["http", "https"].includes(protocol) || origin !== source.origin ||
        source.origin !== new URL(`${protocol}://${c.req.header("Host")}`).origin) throw new Error();
    } catch { return c.json({ error: "Same-origin request required" }, 403); }
  }
}
function bytes(c: Context) {
  if (!/^application\/octet-stream(?:;|$)/i.test(c.req.header("Content-Type") ?? ""))
    throw new MediaError(415, "Use application/octet-stream image bytes");
  const length = c.req.header("Content-Length");
  if (length && (!/^\d+$/.test(length) || Number(length) > MEDIA_MAX_BYTES))
    throw new MediaError(413, "Image exceeds 20 MiB");
  return { stream: c.req.raw.body, expected: c.req.header("X-Stash-Content-SHA256") ?? "", signal: c.req.raw.signal };
}
function summary(value: Manifest | undefined) {
  return value ? { state: "available", sha256: value.original_sha, bytes: value.size, mime: value.mime,
    width: value.width, height: value.height } : { state: "pending" };
}
export function installMediaRoutes(app: Hono, cache: ReturnType<typeof attachWebsocketServer>, user: string, root: string, notify: () => void) {
  const router = new Hono();
  router.use("*", async (c, next) => { const denied = secure(c, user); if (denied) return denied; await next(); });
  router.onError((error, c) => {
    if (error instanceof MediaError) return c.json({ error: error.message }, error.status as 400);
    return c.json({ error: "Private image operation failed; retry or check storage" }, 503);
  });
  async function use<T>(fn: (db: Database.Database) => T | Promise<T>): Promise<T> {
    let result!: T;
    await cache.use(DATABASE_ROOM, SCHEMA_NAME, async peer => {
      const db = peer.getDB();
      // Upstream creates each reopened handle with synchronous=NORMAL.
      // Set FULL on every acquisition, before a manifest/creation transaction.
      db.pragma("synchronous = FULL");
      result = await fn(db);
    });
    return result;
  }
  router.get("/items/:id/status", async c => {
    const id = checkedId(c.req.param("id"));
    return c.json(await use(db => { requireImage(db, id); return summary(manifest(db, id)); }));
  });
  router.put("/items/:id/original", async c => {
    const id = checkedId(c.req.param("id"));
    await use(db => requireImage(db, id));
    const upload = bytes(c);
    const value = { media_id: id, ...await receiveImage(root, upload.stream, upload.expected, upload.signal) };
    await use(db => db.transaction(() => {
      // Metadata may disappear/type-change while an upload is in flight. Never
      // INSERT sync_items on this path, even after every byte is durable.
      requireImage(db, id); commitManifest(db, value);
    })());
    return c.json(summary(value));
  });
  for (const kind of ["original", "preview", "thumbnail"] as const) {
    router.get(`/items/:id/${kind}`, async c => {
      const id = checkedId(c.req.param("id"));
      const value = await use(db => {
        requireImage(db, id);
        const value = manifest(db, id);
        if (!value) throw new MediaError(404, "Image bytes pending upload");
        return value;
      });
      const file = await mediaFile(root, value, kind);
      c.header("Content-Type", file.mime); c.header("Content-Length", String(file.size));
      c.header("X-Stash-Content-SHA256", file.digest);
      c.header("Content-Disposition", `inline; filename="image.${kind === "original" ? value.mime.split("/")[1] : "jpeg"}"`);
      return c.body(Readable.toWeb(createReadStream(file.filename)) as ReadableStream);
    });
  }
  // The client chooses one random UUID per creation and retains it for retries.
  // Original identity remains item.id; the UUID is not an authorization token.
  router.put("/uploads/:id", async c => {
    const id = checkedId(c.req.param("id"));
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)) throw new MediaError(400, "Random UUID upload ID required");
    await use(db => {
      const stage = db.prepare("SELECT finalized FROM stash_media_uploads_v1 WHERE upload_id=?").get(id) as { finalized: number } | undefined;
      if (stage?.finalized) {
        if (!db.prepare("SELECT id FROM sync_items WHERE id=?").get(id)) throw new MediaError(410, "Created item was deleted");
      } else if (db.prepare("SELECT id FROM sync_items WHERE id=?").get(id)) throw new MediaError(409, "Item ID already exists");
    });
    const upload = bytes(c);
    const value = { media_id: id, ...await receiveImage(root, upload.stream, upload.expected, upload.signal) };
    await use(db => db.transaction(() => {
      const stage = db.prepare("SELECT finalized FROM stash_media_uploads_v1 WHERE upload_id=?").get(id) as { finalized: number } | undefined;
      if (stage?.finalized) requireImage(db, id);
      else if (db.prepare("SELECT id FROM sync_items WHERE id=?").get(id)) throw new MediaError(409, "Item ID already exists");
      commitManifest(db, value);
      db.prepare("INSERT OR IGNORE INTO stash_media_uploads_v1(upload_id,created_at) VALUES (?,?)").run(id, Date.now());
    })());
    return c.json({ uploadId: id, ...summary(value) });
  });
  router.post("/uploads/:id/finalize", async c => {
    const id = checkedId(c.req.param("id"));
    if (!/^application\/json(?:;|$)/i.test(c.req.header("Content-Type") ?? "")) throw new MediaError(415, "JSON required");
    // A separate small bound, never relax the existing JSON API's 64 KiB gate.
    const reader = c.req.raw.body?.getReader(); let raw = ""; let count = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      if (!reader) throw new MediaError(400, "JSON required");
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        count += chunk.value.length; if (count > 4096) throw new MediaError(413, "Request too large");
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } finally { await reader?.cancel().catch(() => {}); }
    let payload: { title?: string | null; folderId?: string | null };
    try { payload = JSON.parse(raw); } catch { throw new MediaError(400, "Invalid JSON"); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some(k => !["title", "folderId"].includes(k)) ||
      (payload.title !== undefined && payload.title !== null && (typeof payload.title !== "string" || payload.title.length > 500 || payload.title.includes("\0"))) ||
      (payload.folderId !== undefined && payload.folderId !== null && (typeof payload.folderId !== "string" || !payload.folderId || payload.folderId.length > 200)))
      throw new MediaError(400, "Invalid image creation fields");
    const title = payload.title ?? null; const folderId = payload.folderId ?? null;
    const fingerprint = JSON.stringify({ title, folderId });
    await use(db => db.transaction(() => {
      const stage = db.prepare("SELECT finalized,final_request FROM stash_media_uploads_v1 WHERE upload_id=?").get(id) as { finalized: number; final_request: string | null } | undefined;
      if (!stage || !manifest(db, id)) throw new MediaError(409, "Upload durable bytes before finalizing");
      if (stage.finalized) {
        if (stage.final_request !== fingerprint) throw new MediaError(409, "Creation retry fields changed");
        if (!db.prepare("SELECT id FROM sync_items WHERE id=?").get(id)) throw new MediaError(410, "Created item was deleted");
        return;
      }
      if (db.prepare("SELECT id FROM sync_items WHERE id=?").get(id)) throw new MediaError(409, "Item ID already exists");
      if (folderId && !db.prepare(`SELECT f.id FROM sync_folders f WHERE f.id=? AND
        (f.deleted=0 OR EXISTS(SELECT 1 FROM sync_item_folders m JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=f.id))`).get(folderId))
        throw new MediaError(404, "Folder not found");
      const value = manifest(db, id)!;
      db.prepare("INSERT INTO sync_items(id,type,media_id,title,mime_type,created_at) VALUES (?,'image',?,?,?,?)")
        .run(id, id, title, value.mime, Date.now());
      if (folderId) {
        db.prepare("UPDATE sync_folders SET deleted=0 WHERE id=?").run(folderId);
        db.prepare("INSERT INTO sync_item_folders(membership_id,item_id,folder_id,added_at) VALUES (?,?,?,?)")
          .run(crypto.randomUUID(), id, folderId, Date.now());
      }
      db.prepare("UPDATE stash_media_uploads_v1 SET finalized=1,final_request=? WHERE upload_id=?").run(fingerprint, id);
    })());
    notify();
    return c.json({ id }, 201);
  });
  app.route("/api/media", router);
}
