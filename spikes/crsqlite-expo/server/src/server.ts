import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installApi } from "./api.js";
import Database from "better-sqlite3";
import { Hono } from "hono";
import { getRequestListener } from "@hono/node-server";
import { readFile } from "node:fs/promises";
import { attachWebsocketServer, internal } from "@vlcn.io/ws-server";
import { DATABASE_ROOM, SCHEMA_NAME, SCHEMA_SQL, SCHEMA_VERSION } from "../schema.js";

const HOST = "127.0.0.1"; // Never expose an origin that can bypass Caddy's auth header.
const PORT = parsePort(process.env.PORT ?? "8787");
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? "./data");
const SCHEMA_DIR = path.resolve(process.env.SCHEMA_DIR ?? "./schemas");
const AUTH_USER = process.env.AUTH_USER ?? "zach";
const TEST_ENDPOINTS = process.env.ENABLE_TEST_ENDPOINTS === "1";

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535 (received ${JSON.stringify(value)})`);
  }
  return port;
}

if (!AUTH_USER || /[\r\n]/.test(AUTH_USER)) throw new Error("AUTH_USER must be a non-empty single-line identity");
// The upstream factory auto-migrates before returning a DB. Inspect persisted
// identity/version read-only before it can run, or overwrite the resident DDL.
const databasePath = path.join(DATA_DIR, DATABASE_ROOM);
const schemaPath = path.join(SCHEMA_DIR, SCHEMA_NAME);
if (existsSync(databasePath)) {
  const existing = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    const schema = existing.prepare("SELECT value FROM crsql_master WHERE key = 'schema_name'").pluck().get();
    const version = existing.prepare("SELECT value FROM crsql_master WHERE key = 'schema_version'")
      .safeIntegers(true).pluck().get();
    if (schema !== SCHEMA_NAME || version !== SCHEMA_VERSION) {
      throw new Error(`Persistent database schema mismatch: expected ${SCHEMA_NAME}@${SCHEMA_VERSION}, got ${String(schema)}@${String(version)}; migration is not automatic`);
    }
  } finally {
    existing.close();
  }
}
if (existsSync(schemaPath) && readFileSync(schemaPath, "utf8") !== SCHEMA_SQL) {
  throw new Error(`Resident schema file does not match ${SCHEMA_NAME}@${SCHEMA_VERSION}; refusing to overwrite`);
}
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
mkdirSync(SCHEMA_DIR, { recursive: true });
if (!existsSync(schemaPath)) writeFileSync(schemaPath, SCHEMA_SQL, { mode: 0o600, flag: "wx" });

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
}

const app = new Hono();
app.onError((_error, c) => c.json({ error: "Request failed" }, 500));

app.get("/healthz", (c) => c.json({ ok: true, bind: HOST, port: PORT, schema: SCHEMA_NAME, schemaVersion: SCHEMA_VERSION.toString() }));
app.get("/sync/status", async (c) => {
  if (c.req.header("X-Auth-User") !== AUTH_USER) return c.json({ error: "Unauthorized" }, 401);

  const clientSiteId = c.req.query("clientSiteId");
  if (typeof clientSiteId !== "string" || !/^[0-9a-f]{32}$/i.test(clientSiteId)) {
    return c.json({ error: "clientSiteId must be a 16-byte hex site ID" }, 400);
  }

  try {
    let result: unknown;
    await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
      const db = peer.getDB();
      const local = db.prepare("SELECT hex(crsql_site_id()) AS siteId").get() as { siteId: string };
      const clientBytes = Buffer.from(clientSiteId, "hex");
      const serverVersion = db.prepare(`SELECT COALESCE(MAX(db_version), 0) AS version
        FROM crsql_changes WHERE site_id IS NOT ?`).get(clientBytes) as { version: number };
      const client = db.prepare(`SELECT version FROM crsql_tracked_peers
        WHERE site_id = ? AND event = 0 AND tag = 0 ORDER BY version DESC LIMIT 1`).get(
        clientBytes,
      ) as { version: number } | undefined;
      const counts = db.prepare(`SELECT
        (SELECT COUNT(*) FROM sync_folders) AS folders,
        (SELECT COUNT(*) FROM sync_items) AS items,
        (SELECT COUNT(*) FROM sync_item_folders) AS memberships,
        (SELECT COUNT(*) FROM sync_text_substitutions) AS substitutions,
        (SELECT COUNT(*) FROM sync_user_settings) AS settings`).get();
      result = {
        schema: SCHEMA_NAME,
        schemaVersion: SCHEMA_VERSION.toString(),
        serverSiteId: local.siteId.toLowerCase(),
        serverVersion: String(serverVersion.version),
        clientSiteId: clientSiteId.toLowerCase(),
        clientSeenVersion: String(client?.version ?? 0),
        restoreMerge: {
          version: 1,
          mergeEqualValues: (db.prepare("SELECT crsql_config_get('merge-equal-values') AS value").get() as { value: number }).value,
        },
        counts,
      };
    });
    return c.json(result as object);
  } catch { return c.json({ error: "Request failed" }, 500); }
});

const server = createServer(getRequestListener(app.fetch));
const sockets = new Set<Socket>();
server.on("connection", (socket) => {
  sockets.add(socket);
  socket.once("close", () => sockets.delete(socket));
});

const wsConfig = {
  dbFolder: DATA_DIR,
  schemaFolder: SCHEMA_DIR,
  pathPattern: /^\/sync(?:\?|$)/,
};
const fsnotify = new internal.FSNotify(wsConfig);
const signalListenersBeforeAttach = new Set(process.listeners("SIGINT"));
const dbCache = attachWebsocketServer(
  server,
  wsConfig,
  undefined,
  fsnotify,
  (request: IncomingMessage, _token: string | null, callback: (error: Error | null) => void) => {
    const identity = request.headers["x-auth-user"];
    if (identity === AUTH_USER) callback(null);
    else callback(new Error("unauthenticated WebSocket upgrade"));
  },
);
// Upstream's eager SIGINT handler destroys database state before connected WS
// clients release their references. Remove only the listener it added.
for (const listener of process.listeners("SIGINT")) {
  if (!signalListenersBeforeAttach.has(listener)) process.removeListener("SIGINT", listener);
}

installApi(app, dbCache, AUTH_USER, () => fsnotify.notifyChanges(DATABASE_ROOM));

// Only these built artifacts are public routes. Never expose the source tree,
// node_modules, data directory, dotfiles or an SPA fallback for unknown APIs.
const builtPublic = fileURLToPath(new URL("../public/", import.meta.url));
const publicDir = existsSync(builtPublic) ? builtPublic : fileURLToPath(new URL("../dist/public/", import.meta.url));
for (const [route, file] of [["/", "index.html"], ["/assets/app.js", "app.js"], ["/assets/app.css", "app.css"]]) {
  app.get(route, async (c) => {
    if (c.req.header("X-Auth-User") !== AUTH_USER) return c.json({ error: "Unauthorized" }, 401);
    const headers = {
      "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      "Referrer-Policy": "no-referrer",
      "Content-Type": file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8",
    };
    try { return c.body(new Uint8Array(await readFile(path.join(publicDir, file))), 200, headers); }
    catch { return c.notFound(); }
  });
}

if (TEST_ENDPOINTS) {
  // Private integration-test hooks; disabled unless explicitly opted in.
  app.post("/test/offline-write", async (c) => {
    try {
      await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        peer.getDB().prepare(`INSERT OR IGNORE INTO sync_items (id, type, content, title, created_at)
          VALUES (?, 'text', ?, ?, 1)`)
          .run("server-offline-item", "written on the server while the app was offline", "Server offline item");
      });
      return c.json({ ok: true });
    } catch { return c.json({ error: "Request failed" }, 500); }
  });

  app.get("/test/items", async (c) => {
    try {
      let items: unknown[] = [];
      await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        items = peer.getDB().prepare(
          "SELECT id, type, content, title FROM sync_items ORDER BY id",
        ).all();
      });
      return c.json(items);
    } catch { return c.json({ error: "Request failed" }, 500); }
  });
}

// Fail before opening the listener if the persistent file is corrupt, lacks
// CR-SQLite metadata, or was created against a different candidate schema.
await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
  if (!peer.schemasMatch(SCHEMA_NAME, SCHEMA_VERSION)) {
    throw new Error(`Persistent database does not match ${SCHEMA_NAME}@${SCHEMA_VERSION}`);
  }
  const db = peer.getDB();
  const integrity = db.pragma("integrity_check", { simple: true });
  if (integrity !== "ok") throw new Error(`SQLite integrity check failed: ${String(integrity)}`);
  const tables = db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'table' AND name IN (
      'sync_folders', 'sync_items', 'sync_item_folders',
      'sync_text_substitutions', 'sync_user_settings'
    )`).all() as { name: string }[];
  const requiredTables = new Set([
    "sync_folders", "sync_items", "sync_item_folders",
    "sync_text_substitutions", "sync_user_settings",
  ]);
  for (const { name } of tables) requiredTables.delete(name);
  if (requiredTables.size) {
    throw new Error(`Persistent database is missing candidate CRR tables: ${[...requiredTables].join(", ")}`);
  }
  const clocks = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
    'sync_folders__crsql_clock', 'sync_items__crsql_clock',
    'sync_item_folders__crsql_clock', 'sync_text_substitutions__crsql_clock',
    'sync_user_settings__crsql_clock'
  )`).all() as { name: string }[];
  if (clocks.length !== 5) {
    throw new Error(`Persistent database is missing one or more CRR clocks (${clocks.length}/5)`);
  }
});

const listening = new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(PORT, HOST, () => {
    server.removeListener("error", reject);
    log("info", "server.listening", { host: HOST, port: PORT, dataDir: DATA_DIR, schema: SCHEMA_NAME, schemaVersion: SCHEMA_VERSION.toString(), testEndpoints: TEST_ENDPOINTS });
    resolve();
  });
});

async function shutdown(signal: string) {
  log("info", "server.shutdown.started", { signal, activeSockets: sockets.size });
  const activeSockets = [...sockets];
  const socketsClosed = Promise.all(activeSockets.map((socket) => new Promise<void>((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once("close", () => resolve());
  })));
  const serverClosed = new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  for (const socket of activeSockets) socket.destroy();
  await Promise.all([serverClosed, socketsClosed]);
  // Allow upstream WS close/unref listeners to finish before tearing down cache.
  await new Promise<void>((resolve) => setImmediate(resolve));
  await dbCache.destroy();
  await fsnotify.shutdown();
  await new Promise<void>((resolve) => setImmediate(resolve));
  log("info", "server.shutdown.completed", { signal });
  // The upstream watcher/debounce stack leaves harmless timer handles alive
  // after its close promise resolves. All sockets, DBs, and the watcher have
  // now been drained; flush logs, then exit so systemd restarts/shuts down cleanly.
  await new Promise<void>((resolve) => process.stdout.write("", () => resolve()));
  process.exit(0);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal).catch((error) => {
      log("error", "server.shutdown.failed", { signal, error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    });
  });
}

await listening;
