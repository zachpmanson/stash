import { createHash, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { Feed } from "feed";
import { js2xml, xml2js, type ElementCompact } from "xml-js";

// Server-local state: deliberately NOT CRRs, and not part of native backup replay.
// Legacy enabled column/triggers remain for non-destructive compatibility;
// publication depends only on active logical folder eligibility, never flags.
export function initializeFeeds(db: Database.Database) {
  db.exec(`CREATE TABLE IF NOT EXISTS folder_feeds (
    folder_id TEXT PRIMARY KEY, feed_id TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0,
    hash TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS feed_entries (
    item_id TEXT PRIMARY KEY, entry_id TEXT NOT NULL, hash TEXT NOT NULL,
    published_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TRIGGER IF NOT EXISTS feed_folder_archive AFTER UPDATE ON sync_folders
    WHEN NEW.archived_at IS NOT NULL OR (NEW.deleted=1 AND NOT EXISTS (
      SELECT 1 FROM sync_item_folders m JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=NEW.id))
    BEGIN UPDATE folder_feeds SET enabled=0 WHERE folder_id=NEW.id; END;
    CREATE TRIGGER IF NOT EXISTS feed_folder_delete AFTER DELETE ON sync_folders
    BEGIN UPDATE folder_feeds SET enabled=0 WHERE folder_id=OLD.id; END;
    CREATE TRIGGER IF NOT EXISTS feed_membership_delete AFTER DELETE ON sync_item_folders
    BEGIN UPDATE folder_feeds SET enabled=0 WHERE folder_id=OLD.folder_id AND EXISTS (
      SELECT 1 FROM sync_folders f WHERE f.id=OLD.folder_id AND f.deleted=1 AND NOT EXISTS (
        SELECT 1 FROM sync_item_folders m JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=f.id)); END;
    CREATE TRIGGER IF NOT EXISTS feed_item_delete AFTER DELETE ON sync_items
    BEGIN UPDATE folder_feeds SET enabled=0 WHERE folder_id IN (
      SELECT f.id FROM sync_folders f WHERE f.deleted=1 AND NOT EXISTS (
        SELECT 1 FROM sync_item_folders m JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=f.id)); END;`);
}

export function canonicalFeedBase(value: string | undefined): string | null {
  if (value === undefined || value === "") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    return url.origin;
  } catch { throw new Error("FEED_BASE_URL must be a credential-free HTTPS origin, without path/query/fragment"); }
}

export class FeedError extends Error {
  constructor(public status: 400 | 404 | 409 | 503, message: string) { super(message); }
}
function folder(db: Database.Database, id: string) {
  const f = db.prepare(`SELECT f.name FROM sync_folders f WHERE f.id=? AND f.archived_at IS NULL
    AND (f.deleted=0 OR (f.deleted=1 AND EXISTS (SELECT 1 FROM sync_item_folders m
      JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=f.id)))`).get(id) as { name: string } | undefined;
  if (!f) throw new FeedError(404, "Feed unavailable");
  return f;
}
type State = { feed_id: string; enabled: number; hash: string; updated_at: number };
const state = (db: Database.Database, id: string) => db.prepare("SELECT * FROM folder_feeds WHERE folder_id=?").get(id) as State | undefined;
const clean = (value: string) => value.replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "");
function clipped(value: string | null, max: number) {
  if (!value) return "";
  return clean(value.length > max ? `${value.slice(0, max)}\n[Truncated]` : value);
}
function sourceUrl(value: string | null) {
  try {
    if (!value || value.length > 4096) return null;
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const feedUrl = (base: string, id: string) => `${base}/feeds/folders/${encodeURIComponent(id)}.atom`;
export function feedSettings(db: Database.Database, id: string, base: string | null, enabled?: boolean) {
  if (!base) throw new FeedError(503, "Backend feed hosting is not configured");
  folder(db, id);
  if (enabled !== undefined) throw new FeedError(409, "Folder feeds are always available for active folders and are read-only; enable/disable is no longer supported");
  return { version: 1, policy: "always-on", enabled: true, url: feedUrl(base, id), backend: base, limit: 50 };
}

type Row = { id: string; type: string; content: string | null; title: string | null; description: string | null; article_text: string | null; created_at: number };
export function renderFeed(db: Database.Database, id: string, base: string | null, _preview = false) {
  if (!base) throw new FeedError(503, "Backend feed hosting is not configured");
  const f = folder(db, id);
  let s = state(db, id);
  // Preview and fetch assign stable metadata lazily without content/CRR writes.
  if (!s) {
    db.prepare("INSERT INTO folder_feeds (folder_id,feed_id,updated_at) VALUES (?,?,?)").run(id, `urn:uuid:${randomUUID()}`, Date.now());
    s = state(db, id)!;
  }
  const rows = db.prepare(`SELECT i.id,i.type,substr(i.content,1,8001) AS content,
    substr(i.title,1,501) AS title,substr(i.description,1,2001) AS description,
    substr(i.article_text,1,12001) AS article_text,i.created_at
    FROM sync_items i WHERE i.archived_at IS NULL AND i.type IN ('text','url') AND i.id IN (
      SELECT m.item_id FROM sync_item_folders m WHERE m.folder_id=?)
    ORDER BY i.created_at DESC,i.id LIMIT 50`).all(id) as Row[];
  const now = Date.now();
  const entries: { title: string; content: string; link: string | null; entry_id: string; hash: string; published_at: number; updated_at: number }[] = [];
  for (const row of rows) {
    const link = row.type === "url" ? sourceUrl(row.content) : null;
    if (row.type === "url" && !link) continue;
    const note = clipped(row.content, 8000);
    const title = clipped(row.title, 500) || (row.type === "text" ? clipped(note.split(/\r?\n/)[0], 200) : link) || "Untitled note";
    const content = row.type === "text" ? note : [link, clipped(row.description, 2000), clipped(row.article_text, 12000)].filter(Boolean).join("\n\n");
    const semantic = { title, content, link };
    const digest = hash(semantic);
    let e = db.prepare("SELECT * FROM feed_entries WHERE item_id=?").get(row.id) as { entry_id: string; hash: string; published_at: number; updated_at: number } | undefined;
    if (!e) {
      const published = Number.isSafeInteger(row.created_at) && row.created_at >= 0 && row.created_at <= now ? row.created_at : now;
      db.prepare("INSERT INTO feed_entries VALUES (?,?,?,?,?)").run(row.id, `urn:uuid:${randomUUID()}`, digest, published, now);
    } else if (e.hash !== digest) db.prepare("UPDATE feed_entries SET hash=?,updated_at=? WHERE item_id=?").run(digest, Math.max(now, e.updated_at + 1), row.id);
    e = db.prepare("SELECT * FROM feed_entries WHERE item_id=?").get(row.id) as typeof e;
    entries.push({ ...semantic, ...e! });
  }
  const title = clipped(f.name, 200) || "Stash folder";
  const digest = hash({ title, base, entries });
  if (digest !== s.hash) {
    db.prepare("UPDATE folder_feeds SET hash=?,updated_at=? WHERE folder_id=?").run(digest, Math.max(now, s.updated_at + 1), id);
    s = state(db, id)!;
  }
  const feed = new Feed({ id: s.feed_id, title, updated: new Date(s.updated_at), copyright: "", link: base,
    feedLinks: { atom: feedUrl(base, id) }, author: { name: "Stash" }, description: "Latest 50 active text/link items. Not a full export." });
  for (const e of entries) feed.addItem({ id: e.entry_id, title: "Entry", link: e.link ?? base,
    date: new Date(e.updated_at), published: new Date(e.published_at), content: "Content" });
  // The established Atom serializer supplies metadata, but assumes HTML item
  // text. Structurally replace those nodes with explicit plaintext (not regex
  // against user data, and not CDATA-as-sanitization).
  const document = xml2js(feed.atom1(), { compact: true }) as ElementCompact;
  const serialized = document.feed.entry;
  const nodes = serialized ? (Array.isArray(serialized) ? serialized : [serialized]) : [];
  nodes.forEach((node: ElementCompact, index: number) => {
    node.title = { _attributes: { type: "text" }, _text: entries[index].title };
    node.content = { _attributes: { type: "text" }, _text: entries[index].content };
  });
  const xml = js2xml(document, { compact: true, spaces: 2 });
  return { xml, etag: `"${createHash("sha256").update(xml).digest("hex")}"`, modified: new Date(s.updated_at).toUTCString() };
}
