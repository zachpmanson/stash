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
  withAppDb,
  isRestorePendingOwned,
} from "./database";
import {
  beginSyncCycleOwned,
  markSyncSnapshotCompleteOwned,
  projectSyncReplicaToLocalOwned,
  SYNC_CRR_SCHEMA_NAME,
  SYNC_CRR_SCHEMA_VERSION,
  SYNC_INITIALIZED_KEY,
} from "./syncReplica";

import { assertRecoveryConfigurationOwned } from "./restoreMerge";
import { useSettingsStore } from "../state/settingsState";

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

export class StashSyncPreparationRequiredError extends Error {
  constructor() {
    super("Prepare this install's local sync replica before connecting.");
    this.name = "StashSyncPreparationRequiredError";
  }
}

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
  restoreMerge?: { version: number; mergeEqualValues: number };
};

type ReactNativeWebSocket = new (
  url: string,
  protocols: string[],
  options: { headers: Record<string, string> },
) => WebSocket;

const statusListeners = new Set<SyncListener>();
const projectionListeners = new Set<() => void>();
let currentStatus: StashSyncStatus = { phase: "stopped" };
type SyncSession = { stop: () => boolean; done: Promise<void> };
type SyncConnectionAttempt = {
  cancelled: boolean;
  controller: AbortController;
  done: Promise<void>;
  cancel: () => void;
};
let activeSession: SyncSession | null = null;
let connectionAttempt: SyncConnectionAttempt | null = null;
let syncRestoreInProgress = false;
// A failed teardown cannot prove that callbacks have stopped. Fail closed until restart.
let shutdownFailure: { error: unknown } | null = null;

// Observers must never interrupt lifecycle bookkeeping or DB teardown.
function notifyStatusListener(listener: SyncListener, status: StashSyncStatus): void {
  try { listener(status); } catch (error) { console.warn("Stash sync status listener failed", error); }
}

function publishStatus(status: StashSyncStatus): void {
  currentStatus = status;
  for (const listener of statusListeners) notifyStatusListener(listener, status);
}

export function subscribeStashSyncStatus(listener: SyncListener): () => void {
  statusListeners.add(listener);
  notifyStatusListener(listener, currentStatus);
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
  readonly #listeners = new Set<() => void>();
  readonly #subscription: ReturnType<typeof SQLite.addDatabaseChangeListener>;
  #applyQueue: Promise<void> = Promise.resolve();
  #closed = false;
  readonly #pending = new Set<Promise<unknown>>();

  #track<T>(operation: () => Promise<T>, whenClosed: T): Promise<T> {
    if (this.#closed) return Promise.resolve(whenClosed);
    const pending = operation();
    this.#pending.add(pending);
    void pending.then(
      () => { this.#pending.delete(pending); },
      () => { this.#pending.delete(pending); },
    );
    return pending;
  }

  constructor(databasePath: string, siteid: Uint8Array) {
    this.siteid = siteid;
    this.#subscription = SQLite.addDatabaseChangeListener((event) => {
      if (event.databaseFilePath !== databasePath || !event.tableName?.startsWith("sync_")) return;
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
    // Serialize CR-SQLite statements with peer-watermark reads and app writes;
    // overlapping async statements can fail during Expo SQLite finalization on Android.
    const rows = await this.#track(() => withAppDb((database) => database.getAllAsync<{
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
    )), []);

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
    const apply = this.#track(() => this.#applyQueue.then(() => withAppDb((database) =>
      database.withTransactionAsync(async () => {
        for (const change of changes) {
          await database.runAsync(
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
        await database.runAsync(TRACK_PEER, siteId, sqliteInteger(end[0]), end[1]);
      }),
    )), undefined);
    this.#applyQueue = apply.catch(() => undefined);
    await apply;
  }

  async getLastSeens(): Promise<[Uint8Array, [bigint, number]][]> {
    const rows = await this.#track(() => withAppDb((database) => database.getAllAsync<{
      site_id: Uint8Array;
      version: number;
      seq: number;
    }>("SELECT site_id, version, seq FROM crsql_tracked_peers WHERE event = 0 AND tag = 0")), []);
    return rows.map((row) => [row.site_id, [BigInt(row.version), row.seq]]);
  }

  async getSchemaNameAndVersion(): Promise<[string, bigint]> {
    return [SYNC_CRR_SCHEMA_NAME, SYNC_CRR_SCHEMA_VERSION];
  }

  onChange(callback: () => void): () => void {
    if (this.#closed) return () => undefined;
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  close(_closeWrappedDB: boolean): void {
    // Reject new work before disposing callbacks; drain work already in flight below.
    this.#closed = true;
    // The Stash database singleton is shared with the app and must stay open.
    this.#subscription.remove();
    this.#listeners.clear();
  }

  async waitForPendingChanges(): Promise<void> {
    await Promise.allSettled([...this.#pending]);
  }
}

async function readSiteId(database: SQLite.SQLiteDatabase): Promise<Uint8Array> {
  const result = await database.getFirstAsync<{ site_id: Uint8Array }>("SELECT crsql_site_id() AS site_id");
  if (!result?.site_id) throw new Error("CR-SQLite returned no local site ID");
  return result.site_id;
}

async function authenticatedHealthCheck(
  base: URL,
  authorization: string,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(new URL("healthz", base), {
    headers: { Authorization: authorization },
    signal,
  });
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
  signal?: AbortSignal,
): Promise<ServerSyncStatus> {
  const url = new URL("sync/status", base);
  url.searchParams.set("clientSiteId", clientSiteId);
  const response = await fetch(url, { headers: { Authorization: authorization }, signal });
  if (!response.ok) throw new Error(`Sync-server status returned HTTP ${response.status}`);
  const status = await response.json() as ServerSyncStatus;
  if (status.schema !== SYNC_CRR_SCHEMA_NAME || status.schemaVersion !== SYNC_CRR_SCHEMA_VERSION.toString()) {
    throw new Error("Sync server schema changed during the session; disconnect before sending more data.");
  }
  siteIdBytes(status.serverSiteId);
  siteIdBytes(status.clientSiteId);
  for (const version of [status.serverVersion, status.clientSeenVersion]) {
    if (typeof version !== "string" || !/^(0|[1-9][0-9]*)$/.test(version)) throw new Error("Sync server returned an invalid version.");
  }
  return status;
}

async function localOutboundVersion(
  serverSiteId: string,
): Promise<bigint> {
  const row = await withAppDb((database) => database.getFirstAsync<{ version: number | bigint }>(`SELECT
    COALESCE(MAX(db_version), 0) AS version FROM crsql_changes WHERE site_id IS NOT ?`,
    siteIdBytes(serverSiteId),
  ));
  // Match ws-client 0.2.0's outbound query: the server excludes its own site ID
  // and the stream cursor is the maximum db_version for all remaining rows.
  return sqliteVersion(row?.version ?? 0);
}

async function isExchanged(
  replica: StashReplica,
  clientSiteId: string,
  status: ServerSyncStatus,
): Promise<{ complete: boolean; signature: string }> {
  if (status.clientSiteId !== clientSiteId) throw new Error("Sync server returned status for a different client site");
  const [ownVersion, lastSeens] = await Promise.all([
    localOutboundVersion(status.serverSiteId),
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

function requireRecoveryCapability(status: ServerSyncStatus): void {
  if (status.restoreMerge?.version !== 1 || status.restoreMerge.mergeEqualValues !== 0) {
    throw new Error("The server does not support safe restore merge with merge-equal-values=0. Restored data remains read-only.");
  }
}

function networkConfig(
  authorization: string,
  databasePath: string,
  siteId: Uint8Array,
  onReplica?: (replica: StashReplica) => void,
): Config {
  return {
    // createSyncedDB awaits dbProvider before it can be stopped. Use the already
    // opened DB/site ID so setup has no second, potentially unbounded DB open/read.
    dbProvider: async () => {
      const replica = new StashReplica(databasePath, siteId);
      onReplica?.(replica);
      return replica;
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
  if (shutdownFailure) throw shutdownFailure.error;
  if (syncRestoreInProgress) throw new Error("Stash sync cannot connect while a backup restore is in progress.");
  if (activeSession || connectionAttempt) throw new Error("Stash sync is already connected or connecting on this install.");
  const notifyStatus = (status: StashSyncStatus) => notifyStatusListener(onStatus, status);

  const attempt: SyncConnectionAttempt = {
    cancelled: false,
    controller: new AbortController(),
    done: Promise.resolve(),
    cancel: () => {
      attempt.cancelled = true;
      attempt.controller.abort();
    },
  };
  connectionAttempt = attempt;
  let setupError: unknown;
  let setupFailed = false;
  let result: { stop: () => boolean } = { stop: () => false };

  // Defer setup so attempt.done is installed before any observer can reenter
  // disconnect/restore and wait for this attempt.
  attempt.done = Promise.resolve().then(async () => {
    try {
      notifyStatus({ phase: "connecting", message: "Checking authenticated Stash sync server…" });
      if (attempt.cancelled) return;
      const base = normalizedBaseUrl(serverUrl);
      const authorization = basicAuthorization(credentials);
      const prepared = await withAppDb(async (database) => {
        if (attempt.cancelled) return null;
        const metadata = await database.getFirstAsync<{ present: number }>(
          "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stash_sync_metadata') AS present",
        );
        if (!metadata?.present) throw new StashSyncPreparationRequiredError();
        const marker = await database.getFirstAsync<{ value: string }>(
          "SELECT value FROM stash_sync_metadata WHERE key = ?",
          SYNC_INITIALIZED_KEY,
        );
        if (!marker) throw new StashSyncPreparationRequiredError();
        await ensureCrsqliteLoaded(database);
        const recoveryPending = await isRestorePendingOwned(database);
        if (recoveryPending) await assertRecoveryConfigurationOwned(database);
        const version = recoveryPending ? await database.getFirstAsync<{ version: number }>("SELECT crsql_db_version() AS version") : null;
        return { databasePath: database.databasePath, siteId: await readSiteId(database), recoveryPending, version: version?.version };
      });
      if (!prepared) return;
      if (attempt.cancelled) return;

      await authenticatedHealthCheck(base, authorization, attempt.controller.signal);
      if (attempt.cancelled) return;
      const { siteId, databasePath } = prepared;
      const clientSiteId = siteIdHex(siteId);
      if (prepared.recoveryPending) {
        const status = await readServerStatus(base, authorization, clientSiteId, attempt.controller.signal);
        requireRecoveryCapability(status);
        if (status.clientSiteId !== clientSiteId || BigInt(status.clientSeenVersion) > BigInt(prepared.version!)) {
          throw new Error("The server has seen a newer version of this recovery identity. Refusing a rewound replica.");
        }
        if (attempt.cancelled) return;
      }
      const syncReplicaRef: { current: StashReplica | null } = { current: null };
      const options = { url: websocketUrl(base), room: DATABASE_ROOM };
      let syncedDb: Awaited<ReturnType<typeof createSyncedDB>> | null = null;
      let cleanup: Promise<void> | null = null;
      const stopAndDrain = (): Promise<void> => {
        if (cleanup) return cleanup;
        const errors: unknown[] = [];
        try { syncedDb?.stop(); } catch (error) { errors.push(error); }
        // stop() may throw before reaching replica.close(). Always close it
        // ourselves, then drain outbound reads and queued inbound writes.
        try { syncReplicaRef.current?.close(false); } catch (error) { errors.push(error); }
        cleanup = (async () => {
          await syncReplicaRef.current?.waitForPendingChanges();
          if (errors.length) throw errors[0];
        })();
        void cleanup.catch((error) => { shutdownFailure = { error }; });
        return cleanup;
      };
      try {
        syncedDb = await createSyncedDB(
          networkConfig(authorization, databasePath, siteId, (replica) => { syncReplicaRef.current = replica; }),
          DATABASE_ROOM,
          options,
        );
        if (attempt.cancelled) {
          await stopAndDrain();
          return;
        }
        await withAppDb(beginSyncCycleOwned);
        if (attempt.cancelled) {
          await stopAndDrain();
          return;
        }
        await syncedDb.start();
        if (attempt.cancelled) {
          await stopAndDrain();
          return;
        }
      } catch (error) {
        await stopAndDrain();
        throw error;
      }

      let running = true;
      let projectedSignature = "";
      const replica = syncReplicaRef.current!;
      const session: SyncSession = {
        done: Promise.resolve(),
        stop: () => {
          if (!running) return false;
          running = false;
          attempt.controller.abort();
          void stopAndDrain();
          notifyStatus({ phase: "stopped", message: "Sync disconnected." });
          return true;
        },
      };
      // Install completion before publishing the session or notifying observers.
      // Polling starts on the next microtask, after this ownership is established.
      const pollTask = Promise.resolve().then(async () => {
        while (running) {
          try {
            const status = await readServerStatus(base, authorization, clientSiteId, attempt.controller.signal);
            if (!running) break;
            if (prepared.recoveryPending) requireRecoveryCapability(status);
            const exchange = await isExchanged(replica, clientSiteId, status);
            if (!running) break;
            if (exchange.complete && exchange.signature !== projectedSignature) {
              const pending = await withAppDb(async (database) => {
                if (!running) return true;
                await beginSyncCycleOwned(database);
                await markSyncSnapshotCompleteOwned(database);
                await projectSyncReplicaToLocalOwned(database);
                const setting = await database.getFirstAsync<{ value: string }>("SELECT value FROM stash_sync_metadata WHERE key = 'projected_au_recipe'");
                if (setting) useSettingsStore.getState().setAuRecipe(setting.value === "1");
                return isRestorePendingOwned(database);
              });
              if (!running) break;
              if (pending) {
                notifyStatus({ phase: "syncing", message: "Uploading recovery relationship reconciliation…" });
                continue;
              }
              projectedSignature = exchange.signature;
              const state = { phase: "synced" as const, message: "Stash data is in sync.", projectedAt: Date.now() };
              notifyStatus(state);
              publishProjection();
            } else if (!exchange.complete) {
              notifyStatus({ phase: "syncing", message: "Waiting for both replicas to exchange all changes…" });
            }
          } catch (error) {
            if (!running) break;
            notifyStatus({ phase: "error", message: error instanceof Error ? error.message : String(error) });
          }
          if (running) await new Promise((resolve) => setTimeout(resolve, SYNC_POLL_MS));
        }
      });
      session.done = pollTask.then(
        () => stopAndDrain(),
        async (error) => { await stopAndDrain(); throw error; },
      );
      void session.done.then(
        () => { if (activeSession === session) activeSession = null; },
        (error) => { shutdownFailure = { error }; },
      );
      activeSession = session;
      result = session;
      notifyStatus({ phase: "syncing", message: "Connected; exchanging sync changes…" });
    } catch (error) {
      if (!attempt.cancelled || shutdownFailure) {
        setupFailed = true;
        setupError = error;
        notifyStatus({ phase: error instanceof StashSyncPreparationRequiredError ? "stopped" : "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (connectionAttempt === attempt) connectionAttempt = null;
    }
  });

  await attempt.done;
  if (setupFailed) throw setupError;
  return result;
}

export function disconnectStashSync(): boolean {
  const cancelledAttempt = connectionAttempt;
  if (cancelledAttempt) cancelledAttempt.cancel();
  if (activeSession) return activeSession.stop();
  publishStatus({ phase: "stopped", message: "Sync disconnected." });
  return cancelledAttempt !== null;
}

function throwIfShutdownFailed(): void {
  if (shutdownFailure) throw shutdownFailure.error;
}

/** Cancel connection setup or stop sync, then wait for all DB reads/projections to finish. */
export async function disconnectStashSyncAndWait(): Promise<void> {
  if (shutdownFailure) throw shutdownFailure.error;
  const attempt = connectionAttempt;
  if (attempt) {
    attempt.cancel();
    await attempt.done;
  }
  throwIfShutdownFailed();
  const session = activeSession;
  if (!session) {
    disconnectStashSync();
    return;
  }
  session.stop();
  await session.done;
}

/** Exclude new sync connection attempts while a backup replaces the local DB. */
export async function withStashSyncRestoreLock<T>(operation: () => Promise<T>): Promise<T> {
  if (syncRestoreInProgress) throw new Error("A backup restore is already in progress.");
  syncRestoreInProgress = true;
  try {
    await disconnectStashSyncAndWait();
    return await operation();
  } finally {
    syncRestoreInProgress = false;
  }
}
