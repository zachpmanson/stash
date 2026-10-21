import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type Database from "better-sqlite3";
import type { attachWebsocketServer } from "@vlcn.io/ws-server";
import { DATABASE_ROOM, SCHEMA_NAME } from "../schema.js";
import type { WebItem, WebFolder } from "./contracts.js";
import { FeedError, feedSettings, renderFeed } from "./feeds.js";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const fail = (message = "Invalid request"): never => {
  throw new ApiError(400, message);
};
function body(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    return fail("Unsupported field");
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    return fail();
  return value;
}
function id(value: unknown): string {
  const result = text(value, 200);
  if (!result) return fail();
  return result;
}
function url(value: unknown): string {
  const result = text(value, 4096)!;
  try {
    const parsed = new URL(result);
    if (
      !["https:", "http:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password
    )
      return fail("Use an http(s) URL without credentials");
    return parsed.href;
  } catch {
    return fail("Use an http(s) URL without credentials");
  }
}
// Native reconciliation revives a tombstoned folder if a surviving generation
// references a live item (add wins). Derive that view without repairs on reads.
const visibleFolder = `(f.deleted = 0 OR (f.deleted = 1 AND EXISTS (
  SELECT 1 FROM sync_item_folders m JOIN sync_items i ON i.id=m.item_id WHERE m.folder_id=f.id)))`;
function reconcile(db: Database.Database) {
  // Same repairs as reconcileSyncRelationshipsOwned before native projection.
  // Include repairs in the mutation transaction, so failures roll everything back.
  db.exec(`UPDATE sync_folders SET deleted=0 WHERE deleted=1 AND id IN (
    SELECT DISTINCT folder_id FROM sync_item_folders
    WHERE item_id IN (SELECT id FROM sync_items) AND folder_id IN (SELECT id FROM sync_folders));
    DELETE FROM sync_item_folders WHERE item_id NOT IN (SELECT id FROM sync_items);`);
}
const membership = `SELECT DISTINCT m.folder_id FROM sync_item_folders m
  JOIN sync_folders f ON f.id=m.folder_id WHERE m.item_id=? AND ${visibleFolder}`;
type ItemRow = {
  id: string;
  type: string;
  content: string | null;
  title: string | null;
  description: string | null;
  article_text: string | null;
  created_at: number;
  archived_at: number | null;
};
const columns =
  "id, type, content, title, description, article_text, created_at, archived_at";
function item(db: Database.Database, row: ItemRow): WebItem {
  const portable = row.type === "text" || row.type === "url";
  let content = portable ? row.content : null;
  // Native peers may carry legacy unsafe links. Do not turn them into browser URLs.
  if (row.type === "url") {
    try {
      content = url(content);
    } catch {
      content = null;
    }
  }
  return {
    ...row,
    content,
    article_text: portable ? row.article_text : null,
    mediaUnavailable: !portable,
    folderIds: (
      db.prepare(membership).all(row.id) as { folder_id: string }[]
    ).map((r) => r.folder_id),
  };
}
function requireItem(db: Database.Database, value: string): ItemRow {
  const row = db
    .prepare(`SELECT ${columns} FROM sync_items WHERE id=?`)
    .get(value) as ItemRow | undefined;
  if (!row) throw new ApiError(404, "Item not found");
  return row;
}
function requireFolder(db: Database.Database, value: string) {
  if (
    !db
      .prepare(
        `SELECT f.id FROM sync_folders f WHERE f.id=? AND ${visibleFolder}`,
      )
      .get(value)
  )
    throw new ApiError(404, "Folder not found");
}

type ApiRequest = {
  body: unknown;
  params: Record<string, string>;
  query: Record<string, string | string[]>;
};

export function installApi(
  app: Hono,
  cache: ReturnType<typeof attachWebsocketServer>,
  authUser: string,
  notify: () => void,
  feedBase: string | null,
) {
  const router = new Hono();
  router.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    if (c.req.header("X-Auth-User") !== authUser)
      return c.json({ error: "Unauthorized" }, 401);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      // Non-simple requests plus no CORS prevent cross-origin Basic-auth CSRF.
      if (
        c.req.header("X-Stash-Request") !== "1" ||
        !/^application\/json(?:;|$)/i.test(
          c.req.header("Content-Type") ?? "",
        ) ||
        c.req.header("Sec-Fetch-Site") === "cross-site"
      ) {
        return c.json({ error: "Same-origin JSON request required" }, 403);
      }
      const origin = c.req.header("Origin");
      if (origin) {
        try {
          if (new URL(origin).host !== c.req.header("Host")) throw new Error();
        } catch {
          return c.json({ error: "Same-origin request required" }, 403);
        }
      }
    }
    await next();
  });
  router.use(
    "*",
    bodyLimit({
      maxSize: 65536,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
  );
  function route(
    method: "get" | "post" | "patch" | "put",
    path: string,
    write: boolean,
    fn: (db: Database.Database, req: ApiRequest) => unknown,
    replicatedWrite = write,
  ) {
    router[method](path, async (c) => {
      let payload: unknown;
      if (write) {
        try {
          payload = await c.req.json();
        } catch {
          throw new ApiError(400, "Invalid JSON");
        }
      }
      const req: ApiRequest = {
        body: payload,
        params: c.req.param(),
        query: Object.fromEntries(
          Object.entries(c.req.queries()).map(([key, values]) => [
            key,
            values.length === 1 ? values[0] : values,
          ]),
        ),
      };
      let result: unknown;
      await cache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        const db = peer.getDB();
        // No await inside transactions; WS and HTTP share this extension-loaded handle.
        result = db.transaction(() => {
          if (replicatedWrite) reconcile(db);
          return fn(db, req);
        })();
        if (replicatedWrite) notify(); // Explicit wakeup after commit; never rely on WAL watcher timing.
      });
      return c.json(result as object, method === "post" ? 201 : 200);
    });
  }
  route("get", "/folders", false, (db, req) => {
    if (Object.keys(req.query).length) fail();
    return db
      .prepare(
        `SELECT f.id, f.name, COALESCE(f.icon, '📁') AS icon, f.created_at, f.archived_at, f.layout
      FROM sync_folders f WHERE ${visibleFolder} ORDER BY f.created_at DESC, f.id`,
      )
      .all() as WebFolder[];
  });
  route("get", "/items", false, (db, req) => {
    if (
      Object.keys(req.query).some(
        (key) => !["folderId", "archived", "offset"].includes(key),
      )
    )
      fail();
    const archived = req.query.archived ?? "false";
    if (archived !== "true" && archived !== "false") fail();
    const offset = req.query.offset ?? "0";
    if (typeof offset !== "string" || !/^\d{1,8}$/.test(offset)) fail();
    const folderId =
      req.query.folderId === undefined ? null : id(req.query.folderId);
    const rows = db
      .prepare(
        `SELECT id, type, title, created_at, archived_at,
        CASE WHEN type='text' THEN substr(content,1,240)
          WHEN type='url' AND length(content)<=4096 THEN content ELSE NULL END AS content,
        NULL AS description, NULL AS article_text
        FROM sync_items i WHERE archived_at IS ${archived === "true" ? "NOT " : ""}NULL
      AND (? IS NULL OR EXISTS (SELECT 1 FROM sync_item_folders m JOIN sync_folders f ON f.id=m.folder_id
        WHERE m.item_id=i.id AND m.folder_id=? AND ${visibleFolder}))
      ORDER BY created_at DESC, id LIMIT 101 OFFSET ?`,
      )
      .all(folderId, folderId, Number(offset)) as ItemRow[];
    return {
      items: rows.slice(0, 100).map((row) => {
        const safe = item(db, row);
        return {
          ...safe,
          content: null,
          article_text: null,
          description: null,
          excerpt:
            row.type === "text" ? (row.content?.slice(0, 240) ?? null) : null,
          domain:
            row.type === "url" && safe.content
              ? new URL(safe.content).hostname
              : null,
        };
      }),
      hasMore: rows.length > 100,
    };
  });
  route("get", "/items/:id", false, (db, req) =>
    item(db, requireItem(db, id(req.params.id))),
  );
  route("post", "/folders", true, (db, req) => {
    const data = body(req.body, ["name"]);
    const name = text(data.name, 200)?.trim();
    if (!name) fail("Name required");
    const folderId = randomUUID();
    db.prepare(
      "INSERT INTO sync_folders (id,name,icon,created_at) VALUES (?,?,'📁',?)",
    ).run(folderId, name, Date.now());
    return { id: folderId };
  });
  route("patch", "/folders/:id", true, (db, req) => {
    const folderId = id(req.params.id);
    requireFolder(db, folderId);
    const data = body(req.body, ["name", "archived", "layout"]);
    if (!Object.keys(data).length) fail();
    if ("name" in data) {
      const name = text(data.name, 200)?.trim();
      if (!name) fail("Name required");
      db.prepare("UPDATE sync_folders SET name=? WHERE id=?").run(
        name,
        folderId,
      );
    }
    if ("layout" in data) {
      if (data.layout !== "grid" && data.layout !== "list")
        fail("Use grid or list layout");
      db.prepare("UPDATE sync_folders SET layout=? WHERE id=?").run(
        data.layout,
        folderId,
      );
    }
    if ("archived" in data) {
      if (typeof data.archived !== "boolean") fail();
      db.prepare("UPDATE sync_folders SET archived_at=? WHERE id=?").run(
        data.archived ? Date.now() : null,
        folderId,
      );
    }
    return { id: folderId };
  });
  route("post", "/items", true, (db, req) => {
    const data = body(req.body, ["type", "content", "title", "folderId"]);
    const folderId = data.folderId === undefined ? null : id(data.folderId);
    if (folderId) requireFolder(db, folderId);
    if (data.type !== "text" && data.type !== "url")
      fail("Only text and links can be created");
    const content =
      data.type === "url" ? url(data.content) : text(data.content, 48000);
    if (!content?.trim()) fail("Content required");
    const title = data.title === undefined ? null : text(data.title, 500, true);
    const itemId = randomUUID();
    db.prepare(
      "INSERT INTO sync_items (id,type,content,title,created_at) VALUES (?,?,?,?,?)",
    ).run(itemId, data.type, content, title, Date.now());
    if (folderId)
      db.prepare(
        "INSERT INTO sync_item_folders (membership_id,item_id,folder_id,added_at) VALUES (?,?,?,?)",
      ).run(randomUUID(), itemId, folderId, Date.now());
    return { id: itemId };
  });
  route("patch", "/items/:id", true, (db, req) => {
    const itemId = id(req.params.id);
    const row = requireItem(db, itemId);
    const data = body(req.body, ["content", "title", "archived"]);
    if (!Object.keys(data).length) fail();
    if (row.type !== "url" && row.type !== "text")
      throw new ApiError(409, "Media is unavailable on the web");
    if ("content" in data) {
      const content =
        row.type === "url" ? url(data.content) : text(data.content, 48000);
      if (!content?.trim()) fail("Content required");
      db.prepare("UPDATE sync_items SET content=? WHERE id=?").run(
        content,
        itemId,
      );
    }
    if ("title" in data)
      db.prepare("UPDATE sync_items SET title=? WHERE id=?").run(
        text(data.title, 500, true),
        itemId,
      );
    if ("archived" in data) {
      if (typeof data.archived !== "boolean") fail();
      db.prepare("UPDATE sync_items SET archived_at=? WHERE id=?").run(
        data.archived ? Date.now() : null,
        itemId,
      );
    }
    return { id: itemId };
  });
  route("put", "/items/:id/folders/:folderId", true, (db, req) => {
    const itemId = id(req.params.id),
      folderId = id(req.params.folderId);
    const row = requireItem(db, itemId);
    if (!["text", "url"].includes(row.type))
      throw new ApiError(409, "Media is unavailable on the web");
    requireFolder(db, folderId);
    const data = body(req.body, ["present"]);
    if (typeof data.present !== "boolean") fail();
    if (!data.present)
      db.prepare(
        "DELETE FROM sync_item_folders WHERE item_id=? AND folder_id=?",
      ).run(itemId, folderId);
    else if (
      !db
        .prepare(
          "SELECT 1 FROM sync_item_folders WHERE item_id=? AND folder_id=?",
        )
        .get(itemId, folderId)
    ) {
      db.prepare(
        "INSERT INTO sync_item_folders (membership_id,item_id,folder_id,added_at) VALUES (?,?,?,?)",
      ).run(randomUUID(), itemId, folderId, Date.now());
    }
    return { id: itemId };
  });
  route("get", "/folders/:id/feed", false, (db, req) => {
    if (Object.keys(req.query).length) fail();
    return feedSettings(db, id(req.params.id), feedBase);
  });
  route("put", "/folders/:id/feed", true, (db, req) => {
    if (Object.keys(req.query).length) fail();
    const data = body(req.body, ["enabled"]);
    if (typeof data.enabled !== "boolean") fail();
    return feedSettings(db, id(req.params.id), feedBase, data.enabled as boolean);
  }, false);
  router.get("/folders/:id/feed/preview", async (c) => {
    if (Object.keys(c.req.query()).length) fail();
    let xml = "";
    await cache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
      const db = peer.getDB();
      xml = db.transaction(() => renderFeed(db, id(c.req.param("id")), feedBase, true))().xml;
    });
    return c.body(xml, 200, { "Content-Type": "application/atom+xml; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  });
  router.all("*", (c) => c.json({ error: "API route not found" }, 404));
  router.onError((error, c) => {
    if (error instanceof FeedError) return c.json({ error: error.message }, error.status);
    if (error instanceof ApiError) {
      switch (error.status) {
        case 400:
          return c.json({ error: error.message }, 400);
        case 404:
          return c.json({ error: error.message }, 404);
        case 409:
          return c.json({ error: error.message }, 409);
      }
    }
    return c.json({ error: "Request failed" }, 500);
  });
  app.route("/api", router);
}
