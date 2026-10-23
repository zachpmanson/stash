import { STASH_SYNC_DEV_TOOLS } from "../utils/syncBuildGate";
import type { SQLiteDatabase, SQLiteBindValue } from "expo-sqlite";
import { ensureCrsqliteLoaded, initSchema, RESTORE_PENDING_KEY } from "./database";
import {
  initializeEmptySyncReplicaOwned, SYNC_CRR_SCHEMA_NAME, SYNC_CRR_SCHEMA_VERSION,
  SYNC_INITIALIZED_KEY, SYNC_PROJECTION_READY_KEY,
} from "./syncReplica";

export const RESTORE_CRR_TABLES = ["sync_folders", "sync_items", "sync_item_folders", "sync_text_substitutions", "sync_user_settings"] as const;
export const RESTORE_MEDIA_SCHEMA = "CREATE TABLE IF NOT EXISTS stash_restore_media (id TEXT PRIMARY KEY, uri TEXT NOT NULL, thumbnail_path TEXT)";
const APP_TABLES = ["folders", "items", "item_folders", "text_substitutions"] as const;
export type SnapshotChange = {
  table: string; pk: Uint8Array; cid: string; val: SQLiteBindValue;
  col_version: number; db_version: number; site_id: Uint8Array; cl: number; seq: number;
};

export async function assertRecoveryConfigurationOwned(db: SQLiteDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ configuration: number }>(
    "SELECT crsql_config_get('merge-equal-values') AS configuration",
  );
  if (row?.configuration !== 0) throw new Error("Restore merge requires CR-SQLite merge-equal-values=0; unknown/nonzero configurations are unsupported.");
}

/** Validate before any source DDL. This handle is an extracted private copy, never the selected ZIP. */
export async function classifyRestoreSourceOwned(db: SQLiteDatabase): Promise<"local" | "seeded"> {
  const integrity = await db.getAllAsync<Record<string, unknown>>("PRAGMA integrity_check");
  if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") throw new Error("Backup database integrity check failed.");
  const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'");
  const names = new Set(tables.map((row) => row.name));
  if (APP_TABLES.some((table) => !names.has(table))) throw new Error("Backup is missing supported Stash app tables.");
  if (!tables.some(({ name }) => /^(sync_|crsql_|stash_sync_)/.test(name) || name.includes("__crsql_"))) return "local";
  if (!names.has("stash_sync_metadata") || !names.has("crsql_master") || RESTORE_CRR_TABLES.some((table) => !names.has(table) || !names.has(`${table}__crsql_clock`))) {
    throw new Error("Partial or unsupported CR-SQLite backup; the current database was not replaced.");
  }
  if (tables.some(({ name }) => name.endsWith("__crsql_clock") && !RESTORE_CRR_TABLES.some((table) => name === `${table}__crsql_clock`))) {
    throw new Error("Backup contains an unsupported replicated table.");
  }
  const seed = await db.getFirstAsync<{ value: string }>("SELECT value FROM stash_sync_metadata WHERE key = ?", SYNC_INITIALIZED_KEY);
  const schema = await db.getAllAsync<{ key: string; value: string }>("SELECT key, CAST(value AS TEXT) AS value FROM crsql_master WHERE key IN ('schema_name', 'schema_version')");
  const metadata = new Map(schema.map((row) => [row.key, row.value]));
  if (seed?.value !== "1" || metadata.get("schema_name") !== SYNC_CRR_SCHEMA_NAME || metadata.get("schema_version") !== SYNC_CRR_SCHEMA_VERSION.toString()) {
    throw new Error("Unsupported backup sync schema or seed version; no data was replaced.");
  }
  if (!STASH_SYNC_DEV_TOOLS) {
    throw new Error("Synced backup recovery requires an Android development or explicitly opted-in sync build. No data was replaced.");
  }
  await ensureCrsqliteLoaded(db);
  await assertRecoveryConfigurationOwned(db);
  return "seeded";
}

export async function exportRestoreChangesOwned(db: SQLiteDatabase): Promise<SnapshotChange[]> {
  const changes = await db.getAllAsync<SnapshotChange>('SELECT "table", pk, cid, val, col_version, db_version, site_id, cl, seq FROM crsql_changes ORDER BY db_version, seq');
  for (const change of changes) {
    if (!RESTORE_CRR_TABLES.some((table) => table === change.table) || !(change.pk instanceof Uint8Array) || !(change.site_id instanceof Uint8Array) || change.site_id.length !== 16 || typeof change.cid !== "string") {
      throw new Error("Unsupported snapshot change record.");
    }
    assertSafeValue(change.val);
    for (const key of ["col_version", "db_version", "cl", "seq"] as const) {
      if (!Number.isSafeInteger(change[key]) || change[key] < 0) throw new Error(`Unsupported snapshot integer: ${key}`);
    }
  }
  return changes;
}

/** Full nine-column public API replay: includes tombstones, membership generations and original origins. */
export async function importRestoreChangesOwned(db: SQLiteDatabase, changes: SnapshotChange[]): Promise<void> {
  for (const row of changes) {
    await db.runAsync('INSERT INTO crsql_changes ("table", pk, cid, val, col_version, db_version, site_id, cl, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.table, row.pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
  }
}

function assertSafeValue(value: SQLiteBindValue): void {
  if (typeof value === "number" && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
    throw new Error("Backup contains a numeric value outside JavaScript's safe range.");
  }
}

async function copyTables(source: SQLiteDatabase, fresh: SQLiteDatabase, tables: readonly string[]): Promise<void> {
  for (const table of tables) {
    const columns = await fresh.getAllAsync<{ name: string; type: string }>(`PRAGMA table_info(${table})`);
    const sourceColumns = await source.getAllAsync<{ name: string; type: string }>(`PRAGMA table_info(${table})`);
    const sourceTypes = new Map(sourceColumns.map(({ name, type }) => [name, type]));
    if (columns.length !== sourceColumns.length || columns.some(({ name, type }) => sourceTypes.get(name) !== type)) {
      throw new Error(`Unsupported backup table schema: ${table}`);
    }
    const names = columns.map(({ name }) => `"${name}"`).join(", ");
    const rows = await source.getAllAsync<Record<string, SQLiteBindValue>>(`SELECT ${names} FROM ${table}`);
    for (const row of rows) {
      const values = columns.map(({ name }) => row[name]);
      values.forEach(assertSafeValue);
      await fresh.runAsync(`INSERT INTO ${table} (${names}) VALUES (${columns.map(() => "?").join(", ")})`, values);
    }
  }
}

/** Exclusively owned temporary files. Never copies site IDs, raw clocks, peer cursors or projection authorization. */
export async function buildFreshRestoreOwned(source: SQLiteDatabase, fresh: SQLiteDatabase): Promise<{ recoveryPending: boolean }> {
  const kind = await classifyRestoreSourceOwned(source);
  const existing = await fresh.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  if (existing.length) throw new Error("Recovery destination must be a genuinely fresh database.");
  // Local-only migrations affect only the extracted copy. Seeded schemas must match exactly.
  if (kind === "local") await initSchema(source, false);
  await initSchema(fresh, false);
  if (kind === "seeded") {
    await ensureCrsqliteLoaded(fresh);
    await assertRecoveryConfigurationOwned(fresh);
    await initializeEmptySyncReplicaOwned(fresh);
    // Compare the replicated column schemas without copying/reseeding their app rows.
    for (const table of RESTORE_CRR_TABLES) {
      const a = await source.getAllAsync(`PRAGMA table_info(${table})`);
      const b = await fresh.getAllAsync(`PRAGMA table_info(${table})`);
      if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Unsupported replicated schema: ${table}`);
    }
  }
  await fresh.withTransactionAsync(async () => {
    await copyTables(source, fresh, APP_TABLES);
    const resources = await source.getFirstAsync<{ present: number }>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'stash_restore_media') AS present");
    if (resources?.present) {
      await fresh.execAsync(RESTORE_MEDIA_SCHEMA);
      await copyTables(source, fresh, ["stash_restore_media"]);
    }
    const downloaded = await source.getFirstAsync<{ present: number }>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'stash_media_local_v1') AS present");
    if (downloaded?.present) {
      await fresh.execAsync(RESTORE_MEDIA_SCHEMA);
      for (const row of await source.getAllAsync<{ item_id: string; uri: string }>("SELECT item_id,uri FROM stash_media_local_v1"))
        await fresh.runAsync("INSERT OR REPLACE INTO stash_restore_media(id,uri,thumbnail_path) VALUES (?,?,NULL)", row.item_id, row.uri);
    }
    if (kind === "seeded") {
      const changes = await exportRestoreChangesOwned(source);
      if (!changes.length) throw new Error("Seeded backup has no historical state; refusing a partial replica.");
      await importRestoreChangesOwned(fresh, changes);
      await fresh.runAsync("INSERT INTO stash_sync_metadata (key, value) VALUES (?, '1'), (?, '0'), (?, '1')", SYNC_INITIALIZED_KEY, SYNC_PROJECTION_READY_KEY, RESTORE_PENDING_KEY);
    }
  });
  return { recoveryPending: kind === "seeded" };
}
