import * as SQLite from "expo-sqlite";
import {
  inspectSyncIntegrity,
  loadCrsqliteExtension,
  mirrorLocalItem,
  mirrorLocalMembership,
  mirrorLocalSubstitution,
  markSyncSnapshotComplete,
  projectSyncReplicaToLocal,
  reconcileSyncRelationships,
  seedSyncReplica,
  SYNC_SCHEMA_SQL,
} from "./syncReplica";

export type SyncReplicaSmokeResult = {
  seedCounts: { folders: number; items: number; memberships: number; substitutions: number };
  idempotentReseed: boolean;
  interruptedSeedRecovered: boolean;
  changeRows: number;
  contentMapping: string | null;
  mediaPathExcluded: boolean;
  projectedTitle: string | null;
  newMembershipGeneration: string | null;
  folderRevived: boolean;
  folderTombstoneRetained: boolean;
  orphanRemoved: boolean;
  integrity: string;
};

/** Isolated, disposable on-device test. Never opens the user's stash.db. */
export async function runSyncReplicaSmoke(): Promise<SyncReplicaSmokeResult> {
  const dbName = `stash-sync-replica-smoke-${Date.now()}.db`;
  const db = await SQLite.openDatabaseAsync(dbName, { useNewConnection: true });
  let finalized = false;

  try {
    await loadCrsqliteExtension(db);
    await db.execAsync(`
      CREATE TABLE folders (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT,
        created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
        archived_at INTEGER, layout TEXT NOT NULL
      );
      CREATE TABLE items (
        id TEXT PRIMARY KEY, type TEXT NOT NULL, uri TEXT NOT NULL, title TEXT,
        description TEXT, favicon_url TEXT, thumbnail_path TEXT, mime_type TEXT,
        created_at INTEGER NOT NULL, archived_at INTEGER, article_text TEXT, article_html TEXT, recipe_json TEXT,
        listened_percent INTEGER NOT NULL DEFAULT 0, lat REAL, lng REAL
      );
      CREATE TABLE item_folders (
        item_id TEXT NOT NULL, folder_id TEXT NOT NULL, added_at INTEGER NOT NULL,
        PRIMARY KEY (item_id, folder_id)
      );
      CREATE TABLE text_substitutions (
        id TEXT PRIMARY KEY, find TEXT NOT NULL, replace TEXT NOT NULL,
        case_sensitive INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      INSERT INTO folders VALUES ('folder-1', 'Inbox', '📥', 10, 10, NULL, 'list');
      INSERT INTO items (
        id, type, uri, title, description, favicon_url, mime_type, created_at, archived_at,
        article_text, article_html, recipe_json, listened_percent, lat, lng
      ) VALUES ('url-1', 'url', 'https://example.invalid', 'Example', NULL, NULL, NULL, 20, NULL, 'article', '<p>article</p>', NULL, 5, -37.8, 144.9);
      INSERT INTO items (
        id, type, uri, title, description, favicon_url, mime_type, created_at, archived_at,
        article_text, article_html, recipe_json, listened_percent, lat, lng
      ) VALUES ('image-1', 'image', 'file:///private/stash/image-1.jpg', NULL, NULL, NULL, 'image/jpeg', 30, NULL, NULL, NULL, NULL, 0, NULL, NULL);
      INSERT INTO item_folders VALUES ('url-1', 'folder-1', 40);
      INSERT INTO text_substitutions VALUES ('sub-1', 'foo', 'bar', 1, 50);
    `);

    await db.execAsync(SYNC_SCHEMA_SQL);
    await db.execAsync(`CREATE TRIGGER fail_sync_seed BEFORE INSERT ON sync_items
      WHEN NEW.id = 'url-1' BEGIN SELECT RAISE(ABORT, 'injected seed failure'); END`);
    let seedFailureObserved = false;
    try {
      await seedSyncReplica(db, true);
    } catch (error) {
      seedFailureObserved = error instanceof Error && error.message.includes("injected seed failure");
    }
    const partialSeed = await db.getFirstAsync<{ folders: number; marker: number }>(`
      SELECT (SELECT COUNT(*) FROM sync_folders) AS folders,
             (SELECT COUNT(*) FROM stash_sync_metadata WHERE key = 'stash_sync_seed_version') AS marker
    `);
    if (!seedFailureObserved || partialSeed?.folders !== 0 || partialSeed?.marker !== 0) {
      throw new Error("An interrupted seed left partial replica data or a false completion marker.");
    }
    await db.execAsync("DROP TRIGGER fail_sync_seed");
    const seedCounts = await seedSyncReplica(db, true);
    if (!seedCounts || seedCounts.folders !== 1 || seedCounts.items !== 2 || seedCounts.memberships !== 1 || seedCounts.substitutions !== 1) {
      throw new Error(`Unexpected fixture seed counts: ${JSON.stringify(seedCounts)}`);
    }
    const secondSeed = await seedSyncReplica(db, true);
    if (secondSeed !== null) throw new Error("Repeat seed was not idempotent.");
    let partialProjectionRefused = false;
    try {
      await projectSyncReplicaToLocal(db);
    } catch (error) {
      partialProjectionRefused = error instanceof Error && error.message.includes("completed sync snapshot");
    }
    if (!partialProjectionRefused) throw new Error("Projection did not refuse an incomplete sync snapshot.");
    let partialReconciliationRefused = false;
    try {
      await reconcileSyncRelationships(db);
    } catch (error) {
      partialReconciliationRefused = error instanceof Error && error.message.includes("completed sync snapshot");
    }
    if (!partialReconciliationRefused) throw new Error("Reconciliation did not refuse an incomplete sync snapshot.");
    await markSyncSnapshotComplete(db);

    const content = await db.getFirstAsync<{ content: string | null }>(
      "SELECT content FROM sync_items WHERE id = 'url-1'",
    );
    const media = await db.getFirstAsync<{ media_id: string | null; content: string | null }>(
      "SELECT media_id, content FROM sync_items WHERE id = 'image-1'",
    );
    if (content?.content !== "https://example.invalid") throw new Error("Portable URL content was not seeded.");
    if (media?.media_id !== "image-1" || media.content !== null) throw new Error("Image path leaked into sync content or media ID mapping failed.");

    await db.runAsync("UPDATE sync_folders SET deleted = 1 WHERE id = 'folder-1'");
    const activeFolderLink = await db.runAsync(
      "INSERT INTO sync_item_folders (membership_id, item_id, folder_id, added_at) VALUES ('new-generation', 'url-1', 'folder-1', 60)",
    );
    void activeFolderLink;
    await reconcileSyncRelationships(db);
    const revived = await db.getFirstAsync<{ deleted: number }>(
      "SELECT deleted FROM sync_folders WHERE id = 'folder-1'",
    );
    if (revived?.deleted !== 0) throw new Error("Concurrent new membership did not revive its folder.");

    await db.runAsync(
      "INSERT INTO sync_folders (id, name, icon, created_at, deleted) VALUES ('folder-deleted', 'Removed', '📁', 10, 1)",
    );
    await reconcileSyncRelationships(db);
    const retainedTombstone = await db.getFirstAsync<{ deleted: number }>(
      "SELECT deleted FROM sync_folders WHERE id = 'folder-deleted'",
    );
    if (retainedTombstone?.deleted !== 1) throw new Error("An unreferenced folder tombstone was not retained.");

    await db.runAsync(
      "INSERT INTO sync_item_folders (membership_id, item_id, folder_id, added_at) VALUES ('orphan', 'missing-item', 'folder-1', 70)",
    );
    await reconcileSyncRelationships(db);
    const orphan = await db.getFirstAsync<{ count: number }>(
      "SELECT COUNT(*) AS count FROM sync_item_folders WHERE membership_id = 'orphan'",
    );
    if (orphan?.count !== 0) throw new Error("Reconciliation left an orphan link active.");

    await db.runAsync("UPDATE sync_items SET title = 'remote edit' WHERE id = 'url-1'");
    await projectSyncReplicaToLocal(db);
    const projectedTitle = await db.getFirstAsync<{ title: string }>(
      "SELECT title FROM items WHERE id = 'url-1'",
    );
    if (projectedTitle?.title !== "remote edit") throw new Error("Remote item changes were not projected to the app tables.");

    const priorGenerations = await db.getAllAsync<{ membership_id: string }>(
      "SELECT membership_id FROM sync_item_folders WHERE item_id = 'url-1' AND folder_id = 'folder-1'",
    );
    await db.runAsync("DELETE FROM item_folders WHERE item_id = 'url-1' AND folder_id = 'folder-1'");
    await mirrorLocalMembership(db, "url-1", "folder-1");
    await db.runAsync(
      "INSERT INTO item_folders (item_id, folder_id, added_at) VALUES ('url-1', 'folder-1', 80)",
    );
    await mirrorLocalMembership(db, "url-1", "folder-1");
    const newGeneration = await db.getFirstAsync<{ membership_id: string }>(
      "SELECT membership_id FROM sync_item_folders WHERE item_id = 'url-1' AND folder_id = 'folder-1'",
    );
    if (!newGeneration || priorGenerations.some((row) => row.membership_id === newGeneration.membership_id)) {
      throw new Error("A local membership re-add did not create a fresh generation.");
    }

    await db.runAsync("UPDATE text_substitutions SET replace = 'baz' WHERE id = 'sub-1'");
    await mirrorLocalSubstitution(db, "sub-1");
    const mirroredSubstitution = await db.getFirstAsync<{ replace: string }>(
      "SELECT replace FROM sync_text_substitutions WHERE id = 'sub-1'",
    );
    if (mirroredSubstitution?.replace !== "baz") throw new Error("Local text substitution edits were not mirrored.");

    await db.runAsync("UPDATE items SET title = 'local edit' WHERE id = 'url-1'");
    await mirrorLocalItem(db, "url-1");
    const mirroredTitle = await db.getFirstAsync<{ title: string }>(
      "SELECT title FROM sync_items WHERE id = 'url-1'",
    );
    if (mirroredTitle?.title !== "local edit") throw new Error("Local item edits were not mirrored.");

    const report = await inspectSyncIntegrity(db);
    if (report.invalidItemTypes || report.orphanMemberships || report.activeLinksToDeletedFolders || report.emptyIds) {
      throw new Error(`Sync integrity failed: ${JSON.stringify(report)}`);
    }
    const changes = await db.getFirstAsync<{ count: number }>("SELECT COUNT(*) AS count FROM crsql_changes");
    const integrity = await db.getFirstAsync<{ integrity_check: string }>("PRAGMA integrity_check");
    if (integrity?.integrity_check !== "ok") throw new Error(`SQLite integrity check: ${integrity?.integrity_check}`);

    await db.execAsync("SELECT crsql_finalize()");
    finalized = true;
    return {
      seedCounts,
      idempotentReseed: secondSeed === null,
      interruptedSeedRecovered: seedFailureObserved && partialSeed?.folders === 0,
      changeRows: changes?.count ?? 0,
      contentMapping: content?.content ?? null,
      mediaPathExcluded: media?.content === null && media.media_id === "image-1",
      projectedTitle: projectedTitle?.title ?? null,
      newMembershipGeneration: newGeneration?.membership_id ?? null,
      folderRevived: revived?.deleted === 0,
      folderTombstoneRetained: retainedTombstone?.deleted === 1,
      orphanRemoved: orphan?.count === 0,
      integrity: integrity.integrity_check,
    };
  } finally {
    if (!finalized) {
      try { await db.execAsync("SELECT crsql_finalize()"); } catch { /* preserve the original error */ }
    }
    try { await db.closeAsync(); } finally {
      await SQLite.deleteDatabaseAsync(dbName);
    }
  }
}
