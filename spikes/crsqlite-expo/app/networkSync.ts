import * as SQLite from "expo-sqlite";
import { Directory, File, Paths } from "expo-file-system";
import { unzip, zip } from "react-native-zip-archive";
import { createSyncedDB, defaultConfig, type Config, type DB } from "@vlcn.io/ws-client";
import type { Change } from "@vlcn.io/ws-common";
import { DATABASE_ROOM, SCHEMA_NAME, SCHEMA_SQL, SCHEMA_VERSION } from "./schema";

const DATABASE_NAME = "crsqlite-network-test.db";
const EXTENSION_ENTRY_POINT = "sqlite3_crsqlite_init";
const CHANGE_COLUMNS = '"table", "pk", "cid", "val", "col_version", "db_version", NULL, "cl", "seq"';
const INSERT_CHANGE = `INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const TRACK_PEER = `INSERT INTO crsql_tracked_peers (site_id, event, version, seq, tag)
  VALUES (?, 0, ?, ?, 0)
  ON CONFLICT DO UPDATE SET
    version = MAX(version, excluded.version),
    seq = CASE version > excluded.version WHEN 1 THEN seq ELSE excluded.seq END`;

export type Note = { id: string; body: string };

class ExpoReplica implements DB {
  readonly siteid: Uint8Array;
  readonly #database: SQLite.SQLiteDatabase;
  readonly #listeners = new Set<() => void>();
  readonly #subscription: ReturnType<typeof SQLite.addDatabaseChangeListener>;

  constructor(database: SQLite.SQLiteDatabase, siteid: Uint8Array) {
    this.#database = database;
    this.siteid = siteid;
    this.#subscription = SQLite.addDatabaseChangeListener((event) => {
      if (event.databaseFilePath === this.#database.databasePath && event.tableName === "notes") {
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

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;

  const db = await SQLite.openDatabaseAsync(DATABASE_NAME, {
    useNewConnection: true,
    enableChangeListener: true,
  });
  await db.loadExtensionAsync("libcrsqlite.so", EXTENSION_ENTRY_POINT);
  const tables = await db.getFirstAsync<{ notes: number; clock: number }>(
    `SELECT
      EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes') AS notes,
      EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'notes__crsql_clock') AS clock`,
  );
  if (!tables?.notes) await db.execAsync(SCHEMA_SQL);
  else if (!tables.clock) await db.execAsync("SELECT crsql_as_crr('notes')");
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

  database = db;
  return db;
}

export async function createAndroidNote(id: string): Promise<Note> {
  const db = await getDatabase();
  const note = { id, body: `offline write from Android (${id})` };
  await db.runAsync("INSERT OR REPLACE INTO notes (id, body) VALUES (?, ?)", note.id, note.body);
  return note;
}

export async function listNotes(): Promise<Note[]> {
  const db = await getDatabase();
  return db.getAllAsync<Note>("SELECT id, body FROM notes ORDER BY id");
}

export async function probeWebSocket(serverUrl: string): Promise<void> {
  const url = `${serverUrl.replace(/^http/, "ws")}/sync`;
  const protocol = btoa(`room=${DATABASE_ROOM}`).replaceAll("=", "");
  await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(url, [protocol]);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`WebSocket probe timed out: ${url}`));
    }, 5_000);
    socket.onopen = () => {
      clearTimeout(timeout);
      socket.close();
      resolve();
    };
    socket.onerror = () => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket probe failed: ${url}`));
    };
    socket.onclose = (event) => {
      if (event.code !== 1000) {
        clearTimeout(timeout);
        reject(new Error(`WebSocket probe closed before opening (code ${event.code})`));
      }
    };
  });
}

export async function startSync(serverUrl: string): Promise<{ stop: () => boolean }> {
  const db = await getDatabase();
  await probeWebSocket(serverUrl);
  const config: Config = {
    dbProvider: async () => {
      const site = await db.getFirstAsync<{ site_id: Uint8Array }>("SELECT crsql_site_id() AS site_id");
      if (!site) throw new Error("CR-SQLite returned no local site id");
      return new ExpoReplica(db, site.site_id);
    },
    transportProvider: defaultConfig.transportProvider,
  };
  const sync = await createSyncedDB(config, DATABASE_ROOM, {
    url: `${serverUrl.replace(/^http/, "ws")}/sync`,
    room: DATABASE_ROOM,
  });
  await sync.start();
  return { stop: () => sync.stop() };
}

export async function backupRestoreZip(): Promise<{ notes: Note[]; crsqlObjects: number }> {
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
  const notes = await restored.getAllAsync<Note>("SELECT id, body FROM notes ORDER BY id");
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
  return { notes, crsqlObjects: crr.count };
}

export async function waitForConvergence(
  serverUrl: string,
  androidNoteId: string,
  timeoutMs = 30_000,
): Promise<Note[]> {
  const deadline = Date.now() + timeoutMs;
  const baseUrl = serverUrl.replace(/^ws/, "http");
  let lastError = "not converged yet";

  while (Date.now() < deadline) {
    try {
      const [localNotes, response] = await Promise.all([
        listNotes(),
        fetch(`${baseUrl}/test/notes`),
      ]);
      if (!response.ok) throw new Error(`Server state endpoint returned ${response.status}`);
      const serverNotes = (await response.json()) as Note[];
      const required = new Set([androidNoteId, "server-offline"]);
      const localIds = new Set(localNotes.map((note) => note.id));
      const serverIds = new Set(serverNotes.map((note) => note.id));
      if ([...required].every((id) => localIds.has(id) && serverIds.has(id))) {
        return localNotes;
      }
      lastError = `local=${[...localIds].join(",")} server=${[...serverIds].join(",")}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Timed out waiting for Android/server convergence: ${lastError}`);
}
