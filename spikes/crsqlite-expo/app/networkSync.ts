import * as SQLite from "expo-sqlite";
import { Directory, File, Paths } from "expo-file-system";
import { unzip, zip } from "react-native-zip-archive";
import { createSyncedDB, defaultConfig, type Config, type DB } from "@vlcn.io/ws-client";
import type { Change } from "@vlcn.io/ws-common";
import { DATABASE_ROOM, SCHEMA_NAME, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

const DATABASE_NAME = "stash-sync-client.db";
const OBSERVER_DATABASE_NAME = "stash-sync-observer.db";
const EXTENSION_ENTRY_POINT = "sqlite3_crsqlite_init";

type RemoteCredentials = { username: string; password: string };
type ReactNativeWebSocket = new (
  url: string,
  protocols: string[],
  options: { headers: Record<string, string> },
) => WebSocket;
const CHANGE_COLUMNS = '"table", "pk", "cid", "val", "col_version", "db_version", NULL, "cl", "seq"';
const INSERT_CHANGE = `INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const TRACK_PEER = `INSERT INTO crsql_tracked_peers (site_id, event, version, seq, tag)
  VALUES (?, 0, ?, ?, 0)
  ON CONFLICT DO UPDATE SET
    version = MAX(version, excluded.version),
    seq = CASE version > excluded.version WHEN 1 THEN seq ELSE excluded.seq END`;

export type SyncItem = { id: string; content: string; title: string };

class ExpoReplica implements DB {
  readonly siteid: Uint8Array;
  readonly #database: SQLite.SQLiteDatabase;
  readonly #listeners = new Set<() => void>();
  readonly #subscription: ReturnType<typeof SQLite.addDatabaseChangeListener>;

  constructor(database: SQLite.SQLiteDatabase, siteid: Uint8Array) {
    this.#database = database;
    this.siteid = siteid;
    this.#subscription = SQLite.addDatabaseChangeListener((event) => {
      if (event.databaseFilePath === this.#database.databasePath && event.tableName === "sync_items") {
        for (const listener of this.#listeners) listener();
      }
    });
  }

  async pullChangeset(
    since: readonly [bigint, number],
    excludeSites: readonly Uint8Array[],
    _localOnly: boolean,
  ): Promise<readonly Change[]> {
    const rows = await this.#database.getAllAsync<{
      table: string;
      pk: Uint8Array;
      cid: string;
      val: unknown;
      col_version: number;
      db_version: number;
      cl: number;
      seq: number;
    }>(
      `SELECT ${CHANGE_COLUMNS} FROM crsql_changes WHERE db_version > ? AND site_id IS NOT ?`,
      Number(since[0]),
      excludeSites[0] ?? null,
    );

    return rows.map((row) => [
      row.table,
      row.pk,
      row.cid,
      row.val,
      BigInt(row.col_version),
      BigInt(row.db_version),
      null,
      BigInt(row.cl),
      row.seq,
    ] as const);
  }

  async applyChangesetAndSetLastSeen(
    changes: readonly Change[],
    siteId: Uint8Array,
    end: readonly [bigint, number],
  ): Promise<void> {
    await this.#database.withTransactionAsync(async () => {
      for (const change of changes) {
        await this.#database.runAsync(
          INSERT_CHANGE,
          change[0],
          change[1],
          change[2],
          change[3] as SQLite.SQLiteBindValue,
          Number(change[4]),
          Number(change[5]),
          siteId,
          Number(change[7]),
          change[8],
        );
      }
      await this.#database.runAsync(TRACK_PEER, siteId, Number(end[0]), end[1]);
    });
  }

  async getLastSeens(): Promise<[Uint8Array, [bigint, number]][]> {
    const rows = await this.#database.getAllAsync<{
      site_id: Uint8Array;
      version: number;
      seq: number;
    }>("SELECT site_id, version, seq FROM crsql_tracked_peers");
    return rows.map((row) => [row.site_id, [BigInt(row.version), row.seq]]);
  }

  async getSchemaNameAndVersion(): Promise<[string, bigint]> {
    return [SCHEMA_NAME, SCHEMA_VERSION];
  }

  onChange(callback: () => void): () => void {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  close(_closeWrappedDB: boolean): void {
    // The test controller owns this shared SQLite connection so it can inspect
    // and write rows between WebSocket disconnect/reconnect attempts.
    this.#subscription.remove();
    this.#listeners.clear();
  }
}

let database: SQLite.SQLiteDatabase | null = null;
let observerDatabase: SQLite.SQLiteDatabase | null = null;

async function openReplicaDatabase(name: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name, {
    useNewConnection: true,
    enableChangeListener: true,
  });
  await db.loadExtensionAsync("libcrsqlite.so", EXTENSION_ENTRY_POINT);
  const tables = await db.getFirstAsync<{ items: number; clock: number }>(
    `SELECT
      EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_items') AS items,
      EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_items__crsql_clock') AS clock`,
  );
  if (!tables?.items) await db.execAsync(SCHEMA_SQL);
  else if (!tables.clock) {
    await db.execAsync(`
      SELECT crsql_as_crr('sync_folders');
      SELECT crsql_as_crr('sync_items');
      SELECT crsql_as_crr('sync_item_folders');
      SELECT crsql_as_crr('sync_text_substitutions');
      SELECT crsql_as_crr('sync_user_settings');`);
  }
  await db.runAsync(
    "INSERT OR REPLACE INTO crsql_master (key, value) VALUES (?, ?)",
    "schema_name",
    SCHEMA_NAME,
  );
  // The schema hash is a 64-bit integer; emit its decimal digits as a SQL
  // literal because expo-sqlite bindings intentionally don't accept bigint.
  await db.execAsync(
    `INSERT OR REPLACE INTO crsql_master (key, value) VALUES ('schema_version', ${SCHEMA_VERSION})`,
  );
  return db;
}

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  database ??= await openReplicaDatabase(DATABASE_NAME);
  return database;
}

async function getObserverDatabase(): Promise<SQLite.SQLiteDatabase> {
  observerDatabase ??= await openReplicaDatabase(OBSERVER_DATABASE_NAME);
  return observerDatabase;
}

async function createItem(db: SQLite.SQLiteDatabase, peer: string, id: string): Promise<SyncItem> {
  const item = { id, content: `offline write from ${peer} (${id})`, title: `${peer} offline item` };
  await db.runAsync(
    "INSERT OR REPLACE INTO sync_items (id, type, content, title, created_at) VALUES (?, 'text', ?, ?, ?)",
    item.id,
    item.content,
    item.title,
    Date.now(),
  );
  return item;
}

export async function createAndroidItem(id: string): Promise<SyncItem> {
  return createItem(await getDatabase(), "Android", id);
}

export async function createObserverItem(id: string): Promise<SyncItem> {
  return createItem(await getObserverDatabase(), "observer peer", id);
}

export async function listItems(): Promise<SyncItem[]> {
  const db = await getDatabase();
  return db.getAllAsync<SyncItem>("SELECT id, content, title FROM sync_items ORDER BY id");
}

function normalizedServerUrl(serverUrl: string): URL {
  const url = new URL(serverUrl.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Server URL must start with https://");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Basic-auth credentials require HTTPS");
  }
  return url;
}

function basicAuthorization(credentials: RemoteCredentials): string {
  const username = credentials.username.trim();
  if (!username || !credentials.password) throw new Error("Enter the Caddy username and password.");
  return `Basic ${btoa(`${username}:${credentials.password}`)}`;
}

function websocketUrl(serverUrl: URL, path: string): string {
  const protocol = serverUrl.protocol === "https:" ? "wss:" : "ws:";
  return new URL(path, serverUrl).toString().replace(/^https?:/, protocol);
}

export async function probeWebSocket(serverUrl: string, credentials: RemoteCredentials): Promise<void> {
  const base = normalizedServerUrl(serverUrl);
  const authorization = basicAuthorization(credentials);
  const health = await fetch(new URL("/healthz", base), {
    headers: { Authorization: authorization },
  });
  if (!health.ok) throw new Error(`Authenticated health check returned HTTP ${health.status}`);

  const url = websocketUrl(base, "/sync");
  const protocol = btoa(`room=${DATABASE_ROOM}`).replaceAll("=", "");
  const Socket = WebSocket as unknown as ReactNativeWebSocket;
  await new Promise<void>((resolve, reject) => {
    const socket = new Socket(url, [protocol], { headers: { Authorization: authorization } });
    let opened = false;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket probe timed out: ${url}`));
    }, 8_000);
    socket.onopen = () => {
      opened = true;
      clearTimeout(timeout);
      socket.close();
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`Authenticated WebSocket probe failed: ${url}`));
    };
    socket.onclose = (event) => {
      if (!opened) {
        clearTimeout(timeout);
        reject(new Error(`WebSocket probe closed before opening (code ${event.code})`));
      }
    };
  });
}

export async function startSync(
  serverUrl: string,
  credentials: RemoteCredentials,
): Promise<{ stop: () => boolean }> {
  const primary = await getDatabase();
  const observer = await getObserverDatabase();
  const base = normalizedServerUrl(serverUrl);
  const authorization = basicAuthorization(credentials);
  await probeWebSocket(serverUrl, credentials);

  function configFor(db: SQLite.SQLiteDatabase): Config {
    return {
      dbProvider: async () => {
        const site = await db.getFirstAsync<{ site_id: Uint8Array }>("SELECT crsql_site_id() AS site_id");
        if (!site) throw new Error("CR-SQLite returned no local site id");
        return new ExpoReplica(db, site.site_id);
      },
      transportProvider: (options) => defaultConfig.transportProvider({
        ...options,
        headers: { Authorization: authorization },
      }),
    };
  }

  const options = { url: websocketUrl(base, "/sync"), room: DATABASE_ROOM };
  const primarySync = await createSyncedDB(configFor(primary), DATABASE_ROOM, options);
  const observerSync = await createSyncedDB(configFor(observer), DATABASE_ROOM, options);
  await primarySync.start();
  try {
    await observerSync.start();
  } catch (error) {
    primarySync.stop();
    throw error;
  }
  return {
    stop: () => {
      const observerStopped = observerSync.stop();
      const primaryStopped = primarySync.stop();
      return observerStopped && primaryStopped;
    },
  };
}

export async function backupRestoreZip(): Promise<{ items: SyncItem[]; crsqlObjects: number }> {
  const db = await getDatabase();
  await db.execAsync("PRAGMA wal_checkpoint(FULL)");

  const id = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const backupRoot = new Directory(Paths.cache, `crsqlite-backup-${id}`);
  backupRoot.create({ intermediates: true, idempotent: true });
  const zipFile = new File(Paths.cache, `crsqlite-backup-${id}.zip`);
  const backupDb = new File(backupRoot, DATABASE_NAME);
  backupDb.create({ overwrite: true, intermediates: true });
  backupDb.write(await db.serializeAsync());
  const manifest = new File(backupRoot, "manifest.json");
  manifest.create({ overwrite: true, intermediates: true });
  manifest.write(JSON.stringify({ app: "stash-crsqlite-spike", format: 1 }));
  await zip(backupRoot.uri, zipFile.uri, 9);

  const restoreRoot = new Directory(Paths.cache, `crsqlite-restore-${id}`);
  restoreRoot.create({ intermediates: true, idempotent: true });
  await unzip(zipFile.uri, restoreRoot.uri);
  const extractedManifest = JSON.parse(await new File(restoreRoot, "manifest.json").text()) as {
    app?: string;
    format?: number;
  };
  if (extractedManifest.app !== "stash-crsqlite-spike" || extractedManifest.format !== 1) {
    throw new Error("Backup ZIP manifest did not survive round-trip");
  }

  const extractedDb = new File(restoreRoot, DATABASE_NAME);
  if (!extractedDb.exists) throw new Error("Backup ZIP is missing the SQLite database");
  await db.execAsync("SELECT crsql_finalize()");
  await db.closeAsync();
  database = null;

  // Mirror Stash's restore flow: replace the SQLite file after closing its
  // handle, remove stale WAL sidecars, and reopen the restored database.
  const sqliteDir = new Directory(Paths.document, "SQLite");
  sqliteDir.create({ intermediates: true, idempotent: true });
  for (const name of [DATABASE_NAME, `${DATABASE_NAME}-wal`, `${DATABASE_NAME}-shm`]) {
    const file = new File(sqliteDir, name);
    if (file.exists) file.delete();
  }
  const restoredFile = new File(sqliteDir, DATABASE_NAME);
  restoredFile.create({ overwrite: true, intermediates: true });
  restoredFile.write(extractedDb.bytesSync());

  const restored = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
    enableChangeListener: true,
  });
  await restored.loadExtensionAsync("libcrsqlite.so", EXTENSION_ENTRY_POINT);
  const items = await restored.getAllAsync<SyncItem>("SELECT id, content, title FROM sync_items ORDER BY id");
  const crr = await restored.getFirstAsync<{ count: number }>(
    "SELECT count(*) AS count FROM sqlite_master WHERE name GLOB 'crsql_*'",
  );
  const schema = await restored.getFirstAsync<{ value: string }>(
    "SELECT value FROM crsql_master WHERE key = 'schema_name'",
  );
  if (schema?.value !== SCHEMA_NAME || !crr || crr.count < 4) {
    await restored.closeAsync();
    throw new Error(`Restored ZIP lost CR-SQLite metadata (schema=${schema?.value}, objects=${crr?.count})`);
  }

  database = restored;
  try { backupRoot.delete(); } catch { /* best-effort cleanup */ }
  try { restoreRoot.delete(); } catch { /* best-effort cleanup */ }
  try { zipFile.delete(); } catch { /* best-effort cleanup */ }
  return { items, crsqlObjects: crr.count };
}

export async function waitForConvergence(
  androidItemId: string,
  observerItemId: string,
  timeoutMs = 30_000,
): Promise<SyncItem[]> {
  const deadline = Date.now() + timeoutMs;
  const required = new Set([androidItemId, observerItemId]);
  let lastError = "not converged yet";

  while (Date.now() < deadline) {
    try {
      const [primaryItems, observerItems] = await Promise.all([
        listItems(),
        getObserverDatabase().then((db) => db.getAllAsync<SyncItem>("SELECT id, content, title FROM sync_items ORDER BY id")),
      ]);
      const primaryIds = new Set(primaryItems.map((item) => item.id));
      const observerIds = new Set(observerItems.map((item) => item.id));
      if ([...required].every((id) => primaryIds.has(id) && observerIds.has(id))) {
        return primaryItems;
      }
      lastError = `Android=${[...primaryIds].join(",")} observer=${[...observerIds].join(",")}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for the two authenticated sync clients to converge: ${lastError}`);
}
