import * as SQLite from "expo-sqlite";
import {
  createSyncedDB,
  defaultConfig,
  type Config,
  type DB,
} from "@vlcn.io/ws-client";
import type { Change } from "@vlcn.io/ws-common";
import {
  ensureCrsqliteLoaded,
  getDb,
  withAppDbWriteLock,
} from "./database";
import {
  beginSyncCycle,
  markSyncSnapshotComplete,
  projectSyncReplicaToLocal,
  SYNC_CRR_SCHEMA_NAME,
  SYNC_CRR_SCHEMA_VERSION,
  SYNC_INITIALIZED_KEY,
} from "./syncReplica";

const DATABASE_ROOM = "stash-backend";
const CHANGE_COLUMNS = '"table", "pk", "cid", "val", "col_version", "db_version", NULL, "cl", "seq"';
const INSERT_CHANGE = `INSERT INTO crsql_changes ("table", "pk", "cid", "val", "col_version", "db_version", "site_id", "cl", "seq") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const TRACK_PEER = `INSERT INTO crsql_tracked_peers (site_id, event, version, seq, tag)
  VALUES (?, 0, ?, ?, 0)
  ON CONFLICT DO UPDATE SET
    version = MAX(version, excluded.version),
    seq = CASE version > excluded.version WHEN 1 THEN seq ELSE excluded.seq END`;
const SYNC_POLL_MS = 1_000;

type Credentials = { username: string; password: string };
type SyncPhase = "connecting" | "syncing" | "synced" | "error" | "stopped";
export type StashSyncStatus = {
  phase: SyncPhase;
  message?: string;
  projectedAt?: number;
};
type SyncListener = (status: StashSyncStatus) => void;
type ServerSyncStatus = {
  schema: string;
  schemaVersion: string;
  serverSiteId: string;
  serverVersion: string;
  clientSiteId: string;
  clientSeenVersion: string;
};

type ReactNativeWebSocket = new (
  url: string,
  protocols: string[],
  options: { headers: Record<string, string> },
) => WebSocket;

const statusListeners = new Set<SyncListener>();
const projectionListeners = new Set<() => void>();
let currentStatus: StashSyncStatus = { phase: "stopped" };
let activeSession: { stop: () => boolean } | null = null;

function publishStatus(status: StashSyncStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) listener(status);
}

export function subscribeStashSyncStatus(listener: SyncListener): () => void {
  statusListeners.add(listener);
  listener(currentStatus);
  return () => statusListeners.delete(listener);
}

/** Fired after a complete remote snapshot has been safely projected to Stash's local tables. */
export function subscribeStashSyncProjection(listener: () => void): () => void {
  projectionListeners.add(listener);
  return () => projectionListeners.delete(listener);
}

function publishProjection(): void {
  for (const listener of projectionListeners) listener();
}

function normalizedBaseUrl(value: string): URL {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Sync server URL must start with https://");
  }
  if (url.protocol === "http:" && !["localhost", "127.0.0.1"].includes(url.hostname)) {
    throw new Error("Basic-auth credentials require HTTPS outside localhost");
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function basicAuthorization(credentials: Credentials): string {
  const username = credentials.username.trim();
  if (!username || !credentials.password) throw new Error("Enter the sync-server username and password.");
  return `Basic ${btoa(`${username}:${credentials.password}`)}`;
}

function websocketUrl(base: URL): string {
  const url = new URL("sync", base);
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function siteIdHex(siteId: Uint8Array): string {
  return Array.from(siteId, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function siteIdBytes(siteId: string): Uint8Array {
  if (!/^[0-9a-f]{32}$/i.test(siteId)) throw new Error("Sync server returned an invalid site ID");
  return new Uint8Array(siteId.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)));
}

function sqliteInteger(value: unknown): number {
  const integer = typeof value === "bigint" ? value : BigInt(value as number | string);
  const number = Number(integer);
  if (!Number.isSafeInteger(number)) throw new Error(`SQLite integer is outside JavaScript's safe range: ${integer}`);
  return number;
}

function sqliteVersion(value: unknown): bigint {
  return typeof value === "bigint" ? value : BigInt(value as number | string);
}

function bindValue(value: unknown): SQLite.SQLiteBindValue {
  if (typeof value === "bigint") return sqliteInteger(value);
  return value as SQLite.SQLiteBindValue;
}

function compareVersion(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

class StashReplica implements DB {
  readonly siteid: Uint8Array;
  readonly #database: SQLite.SQLiteDatabase;
  readonly #listeners = new Set<() => void>();
  readonly #subscription: ReturnType<typeof SQLite.addDatabaseChangeListener>;
  #applyQueue: Promise<void> = Promise.resolve();

  constructor(database: SQLite.SQLiteDatabase, siteid: Uint8Array) {
    this.#database = database;
    this.siteid = siteid;
    this.#subscription = SQLite.addDatabaseChangeListener((event) => {
      if (event.databaseFilePath !== database.databasePath || !event.tableName?.startsWith("sync_")) return;
      for (const listener of this.#listeners) listener();
    });
  }

  async pullChangeset(
    since: readonly [bigint, number],
    excludeSites: readonly Uint8Array[],
    _localOnly: boolean,
  ): Promise<readonly Change[]> {
    const excluded = excludeSites.length > 0
      ? ` AND site_id NOT IN (${excludeSites.map(() => "?").join(", ")})`
      : "";
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
      `SELECT ${CHANGE_COLUMNS} FROM crsql_changes WHERE db_version > ?${excluded}`,
      sqliteInteger(since[0]),
      ...excludeSites,
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
    const apply = this.#applyQueue.then(() => withAppDbWriteLock(() =>
      this.#database.withTransactionAsync(async () => {
        for (const change of changes) {
          await this.#database.runAsync(
            INSERT_CHANGE,
            change[0],
            change[1],
            change[2],
            bindValue(change[3]),
            sqliteInteger(change[4]),
            sqliteInteger(change[5]),
            siteId,
            sqliteInteger(change[7]),
            change[8],
          );
        }
        await this.#database.runAsync(TRACK_PEER, siteId, sqliteInteger(end[0]), end[1]);
      }),
    ));
    this.#applyQueue = apply.catch(() => undefined);
    await apply;
  }

  async getLastSeens(): Promise<[Uint8Array, [bigint, number]][]> {
    const rows = await this.#database.getAllAsync<{
      site_id: Uint8Array;
      version: number;
      seq: number;
    }>("SELECT site_id, version, seq FROM crsql_tracked_peers WHERE event = 0 AND tag = 0");
    return rows.map((row) => [row.site_id, [BigInt(row.version), row.seq]]);
  }

  async getSchemaNameAndVersion(): Promise<[string, bigint]> {
    return [SYNC_CRR_SCHEMA_NAME, SYNC_CRR_SCHEMA_VERSION];
  }

  onChange(callback: () => void): () => void {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  close(_closeWrappedDB: boolean): void {
    // The Stash database singleton is shared with the app and must stay open.
    this.#subscription.remove();
    this.#listeners.clear();
  }
}

async function readSiteId(database: SQLite.SQLiteDatabase): Promise<Uint8Array> {
  const result = await database.getFirstAsync<{ site_id: Uint8Array }>("SELECT crsql_site_id() AS site_id");
  if (!result?.site_id) throw new Error("CR-SQLite returned no local site ID");
  return result.site_id;
}

async function authenticatedHealthCheck(base: URL, authorization: string): Promise<void> {
  const response = await fetch(new URL("healthz", base), { headers: { Authorization: authorization } });
  if (!response.ok) throw new Error(`Authenticated sync-server health check returned HTTP ${response.status}`);
  const health = await response.json() as { schema?: string; schemaVersion?: string };
  if (health.schema !== SYNC_CRR_SCHEMA_NAME || health.schemaVersion !== SYNC_CRR_SCHEMA_VERSION.toString()) {
    throw new Error(
      `Sync server schema mismatch: expected ${SYNC_CRR_SCHEMA_NAME}@${SYNC_CRR_SCHEMA_VERSION}, ` +
      `received ${health.schema ?? "unknown"}@${health.schemaVersion ?? "unknown"}. No Stash data was sent.`,
    );
  }
}

async function readServerStatus(
  base: URL,
  authorization: string,
  clientSiteId: string,
): Promise<ServerSyncStatus> {
  const url = new URL("sync/status", base);
  url.searchParams.set("clientSiteId", clientSiteId);
  const response = await fetch(url, { headers: { Authorization: authorization } });
  if (!response.ok) throw new Error(`Sync-server status returned HTTP ${response.status}`);
  const status = await response.json() as ServerSyncStatus;
  if (status.schema !== SYNC_CRR_SCHEMA_NAME || status.schemaVersion !== SYNC_CRR_SCHEMA_VERSION.toString()) {
    throw new Error("Sync server schema changed during the session; disconnect before sending more data.");
  }
  return status;
}

async function localOutboundVersion(
  database: SQLite.SQLiteDatabase,
  serverSiteId: string,
): Promise<bigint> {
  const row = await database.getFirstAsync<{ version: number | bigint }>(`SELECT
    COALESCE(MAX(db_version), 0) AS version FROM crsql_changes WHERE site_id IS NOT ?`,
    siteIdBytes(serverSiteId),
  );
  // Match ws-client 0.2.0's outbound query: the server excludes its own site ID
  // and the stream cursor is the maximum db_version for all remaining rows.
  return sqliteVersion(row?.version ?? 0);
}

async function isExchanged(
  database: SQLite.SQLiteDatabase,
  replica: StashReplica,
  clientSiteId: string,
  status: ServerSyncStatus,
): Promise<{ complete: boolean; signature: string }> {
  if (status.clientSiteId !== clientSiteId) throw new Error("Sync server returned status for a different client site");
  const [ownVersion, lastSeens] = await Promise.all([
    localOutboundVersion(database, status.serverSiteId),
    replica.getLastSeens(),
  ]);
  const seenByServer = BigInt(status.clientSeenVersion);
  if (compareVersion(seenByServer, ownVersion) < 0) {
    return { complete: false, signature: "" };
  }

  const seen = new Map(lastSeens.map(([siteId, version]) => [siteIdHex(siteId), version[0]]));
  const localSeenServer = seen.get(status.serverSiteId) ?? 0n;
  const serverVersion = BigInt(status.serverVersion);
  if (compareVersion(localSeenServer, serverVersion) < 0) {
    return { complete: false, signature: "" };
  }

  return {
    complete: true,
    signature: JSON.stringify({
      own: ownVersion.toString(),
      serverSiteId: status.serverSiteId,
      serverVersion: serverVersion.toString(),
      serverSeen: seenByServer.toString(),
    }),
  };
}

function networkConfig(authorization: string): Config {
  return {
    dbProvider: async () => {
      const database = await getDb();
      const siteId = await readSiteId(database);
      return new StashReplica(database, siteId);
    },
    transportProvider: (options) => defaultConfig.transportProvider({
      ...options,
      headers: { ...options.headers, Authorization: authorization },
    }),
  };
}

export async function connectStashSync(
  serverUrl: string,
  credentials: Credentials,
  onStatus: SyncListener = publishStatus,
): Promise<{ stop: () => boolean }> {
  if (activeSession) throw new Error("Stash sync is already connected on this install.");
  onStatus({ phase: "connecting", message: "Checking authenticated Stash sync server…" });
  const prepared = await (async () => {
    try {
      const base = normalizedBaseUrl(serverUrl);
      const authorization = basicAuthorization(credentials);
      const database = await getDb();
      await ensureCrsqliteLoaded(database);

      const marker = await database.getFirstAsync<{ value: string }>(
        "SELECT value FROM stash_sync_metadata WHERE key = ?",
        SYNC_INITIALIZED_KEY,
      );
      if (!marker) throw new Error("Prepare this install's local sync replica before connecting.");

      await authenticatedHealthCheck(base, authorization);
      const siteId = await readSiteId(database);
      const clientSiteId = siteIdHex(siteId);
      const options = { url: websocketUrl(base), room: DATABASE_ROOM };
      const syncedDb = await createSyncedDB(networkConfig(authorization), DATABASE_ROOM, options);
      try {
        await beginSyncCycle(database);
        await syncedDb.start();
      } catch (error) {
        syncedDb.stop();
        throw error;
      }
      return { base, authorization, database, siteId, clientSiteId, syncedDb };
    } catch (error) {
      onStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  })();
  const { base, authorization, database, siteId, clientSiteId, syncedDb } = prepared;
  let running = true;
  let projectedSignature = "";
  const replica = new StashReplica(database, siteId);
  // This adapter is only used for status reads; release its listener immediately.
  replica.close(false);
  const session = {
    stop: () => {
      if (!running) return false;
      running = false;
      syncedDb.stop();
      if (activeSession === session) activeSession = null;
      onStatus({ phase: "stopped", message: "Sync disconnected." });
      return true;
    },
  };
  activeSession = session;
  onStatus({ phase: "syncing", message: "Connected; exchanging sync changes…" });

  void (async () => {
    while (running) {
      try {
        const status = await readServerStatus(base, authorization, clientSiteId);
        const exchange = await isExchanged(database, replica, clientSiteId, status);
        if (exchange.complete && exchange.signature !== projectedSignature) {
          await beginSyncCycle(database);
          await markSyncSnapshotComplete(database);
          await projectSyncReplicaToLocal(database);
          projectedSignature = exchange.signature;
          const state = { phase: "synced" as const, message: "Stash data is in sync.", projectedAt: Date.now() };
          onStatus(state);
          publishProjection();
        } else if (!exchange.complete) {
          onStatus({ phase: "syncing", message: "Waiting for both replicas to exchange all changes…" });
        }
      } catch (error) {
        onStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
      }
      await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
    }
  })();

  return session;
}

export function disconnectStashSync(): boolean {
  if (activeSession) return activeSession.stop();
  publishStatus({ phase: "stopped", message: "Sync disconnected." });
  return false;
}
