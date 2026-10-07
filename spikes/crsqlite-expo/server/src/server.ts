import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import express from "express";
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
mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
mkdirSync(SCHEMA_DIR, { recursive: true });
writeFileSync(path.join(SCHEMA_DIR, SCHEMA_NAME), SCHEMA_SQL, { mode: 0o600 });

function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  process.stdout.write(`${JSON.stringify({ time: new Date().toISOString(), level, event, ...fields })}\n`);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.get("/healthz", (_request, response) => response.json({ ok: true, bind: HOST, port: PORT, schema: SCHEMA_NAME, schemaVersion: SCHEMA_VERSION.toString() }));

const server = createServer(app);
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

if (TEST_ENDPOINTS) {
  // Private integration-test hooks; disabled unless explicitly opted in.
  app.post("/test/offline-write", async (_request, response, next) => {
    try {
      await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        peer.getDB().prepare(`INSERT OR IGNORE INTO sync_items (id, type, content, title, created_at)
          VALUES (?, 'text', ?, ?, 1)`)
          .run("server-offline-item", "written on the server while the app was offline", "Server offline item");
      });
      response.json({ ok: true });
    } catch (error) { next(error); }
  });

  app.get("/test/items", async (_request, response, next) => {
    try {
      let items: unknown[] = [];
      await dbCache.use(DATABASE_ROOM, SCHEMA_NAME, async (peer) => {
        items = peer.getDB().prepare(
          "SELECT id, type, content, title FROM sync_items ORDER BY id",
        ).all();
      });
      response.json(items);
    } catch (error) { next(error); }
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
