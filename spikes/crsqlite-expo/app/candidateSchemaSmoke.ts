import * as SQLite from "expo-sqlite";
import { STASH_SCHEMA_SQL } from "./stashSchema";

const EXTENSION_ENTRY_POINT = "sqlite3_crsqlite_init";

export type CandidateSchemaSmokeResult = {
  crSqliteTables: number;
  changeRows: number;
  deleteTombstones: number;
  integrity: string;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

/**
 * Runs the reviewed candidate DDL against a fresh disposable on-device DB.
 * This is a local-only native packaging/schema smoke test; no sync/server or
 * Stash production database is opened.
 */
export async function runCandidateSchemaSmoke(): Promise<CandidateSchemaSmokeResult> {
  const name = `stash-candidate-smoke-${Date.now()}-${Math.random().toString(36).slice(2)}.db`;
  const db = await SQLite.openDatabaseAsync(name, { useNewConnection: true });
  let finalized = false;

  try {
    await db.loadExtensionAsync("libcrsqlite.so", EXTENSION_ENTRY_POINT);
    await db.execAsync(STASH_SCHEMA_SQL);

    const crr = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'sync_folders__crsql_clock', 'sync_items__crsql_clock',
         'sync_item_folders__crsql_clock', 'sync_text_substitutions__crsql_clock',
         'sync_user_settings__crsql_clock'
       )`,
    );
    assert(crr?.count === 5, `expected 5 CRR clock tables, found ${crr?.count ?? 0}`);

    await db.withTransactionAsync(async () => {
      await db.runAsync(
        "INSERT INTO sync_folders (id, name, created_at) VALUES ('folder-smoke', 'Smoke', 1)",
      );
      await db.runAsync(
        "INSERT INTO sync_items (id, type, content, title, created_at) VALUES ('item-smoke', 'url', 'https://example.invalid', 'Smoke item', 2)",
      );
      await db.runAsync(
        "INSERT INTO sync_item_folders (membership_id, item_id, folder_id, added_at) VALUES ('membership-smoke', 'item-smoke', 'folder-smoke', 3)",
      );
      await db.runAsync(
        "INSERT INTO sync_text_substitutions (id, find, replace, created_at) VALUES ('sub-smoke', 'a', 'b', 4)",
      );
      await db.runAsync(
        "INSERT INTO sync_user_settings (id, au_recipe) VALUES ('user', 1)",
      );
    });

    const changed = await db.getFirstAsync<{ count: number }>(
      "SELECT count(*) AS count FROM crsql_changes",
    );
    assert((changed?.count ?? 0) > 0, "candidate rows produced no CR-SQLite changes");

    await db.withTransactionAsync(async () => {
      await db.runAsync("DELETE FROM sync_item_folders WHERE item_id = 'item-smoke'");
      await db.runAsync("DELETE FROM sync_items WHERE id = 'item-smoke'");
    });

    const tombstones = await db.getFirstAsync<{ count: number }>(
      `SELECT count(*) AS count FROM crsql_changes
       WHERE "table" = 'sync_items' AND cid = '-1'`,
    );
    assert((tombstones?.count ?? 0) > 0, "item delete did not produce a CR-SQLite tombstone");

    const integrity = await db.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check");
    assert(integrity?.integrity_check === "ok", `SQLite integrity check failed: ${integrity?.integrity_check}`);

    await db.execAsync("SELECT crsql_finalize()");
    finalized = true;
    return {
      crSqliteTables: crr.count,
      changeRows: changed?.count ?? 0,
      deleteTombstones: tombstones?.count ?? 0,
      integrity: integrity.integrity_check,
    };
  } finally {
    if (!finalized) {
      try { await db.execAsync("SELECT crsql_finalize()"); } catch { /* preserve the test error */ }
    }
    try { await db.closeAsync(); } finally {
      await SQLite.deleteDatabaseAsync(name);
    }
  }
}
