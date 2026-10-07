import type * as SQLite from "expo-sqlite";
import { CRSQLITE_SUPPORTED, ensureCrsqliteLoaded, getDb, withAppDbWriteLock } from "./database";
import { randomId } from "../utils/randomId";

export const SYNC_SCHEMA_VERSION = 1;
export const CRSQLITE_EXTENSION_ENTRY_POINT = "sqlite3_crsqlite_init";
export const SYNC_INITIALIZED_KEY = "stash_sync_seed_version";
export const SYNC_PROJECTION_READY_KEY = "stash_sync_projection_ready";

/**
 * CR-SQLite tables for Stash's replicated user data. Keep this schema aligned
 * with spikes/crsqlite-expo/schemas/stash-sync-v1.sql and the server schema.
 * Local filesystem paths and last-used timestamps deliberately stay local.
 */
export const SYNC_SCHEMA_SQL = String.raw`
CREATE TABLE IF NOT EXISTS sync_folders (
  id TEXT NOT NULL PRIMARY KEY DEFAULT '',
  name TEXT NOT NULL DEFAULT '',
  icon TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER DEFAULT NULL,
  layout TEXT NOT NULL DEFAULT 'grid',
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_items (
  id TEXT NOT NULL PRIMARY KEY DEFAULT '',
  type TEXT NOT NULL DEFAULT 'text',
  content TEXT DEFAULT NULL,
  media_id TEXT DEFAULT NULL,
  title TEXT DEFAULT NULL,
  description TEXT DEFAULT NULL,
  favicon_url TEXT DEFAULT NULL,
  mime_type TEXT DEFAULT NULL,
  created_at INTEGER NOT NULL DEFAULT 0,
  archived_at INTEGER DEFAULT NULL,
  article_text TEXT DEFAULT NULL,
  article_html TEXT DEFAULT NULL,
  recipe_json TEXT DEFAULT NULL,
  listened_percent INTEGER NOT NULL DEFAULT 0,
  lat REAL DEFAULT NULL,
  lng REAL DEFAULT NULL
);
CREATE TABLE IF NOT EXISTS sync_item_folders (
  membership_id TEXT NOT NULL PRIMARY KEY DEFAULT '',
  item_id TEXT NOT NULL DEFAULT '',
  folder_id TEXT NOT NULL DEFAULT '',
  added_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_text_substitutions (
  id TEXT NOT NULL PRIMARY KEY DEFAULT '',
  find TEXT NOT NULL DEFAULT '',
  replace TEXT NOT NULL DEFAULT '',
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_user_settings (
  id TEXT NOT NULL PRIMARY KEY DEFAULT '',
  au_recipe INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sync_memberships_item ON sync_item_folders(item_id);
CREATE INDEX IF NOT EXISTS idx_sync_memberships_folder ON sync_item_folders(folder_id);
CREATE INDEX IF NOT EXISTS idx_sync_items_created ON sync_items(created_at DESC);
SELECT crsql_as_crr('sync_folders');
SELECT crsql_as_crr('sync_items');
SELECT crsql_as_crr('sync_item_folders');
SELECT crsql_as_crr('sync_text_substitutions');
SELECT crsql_as_crr('sync_user_settings');
CREATE TABLE IF NOT EXISTS stash_sync_metadata (
  key TEXT NOT NULL PRIMARY KEY,
  value TEXT NOT NULL
);
`;

type LocalFolder = {
  id: string | null;
  name: string;
  icon: string | null;
  created_at: number;
  archived_at: number | null;
  layout: string;
};

type LocalItem = {
  id: string | null;
  type: string;
  uri: string;
  title: string | null;
  description: string | null;
  favicon_url: string | null;
  mime_type: string | null;
  created_at: number;
  archived_at: number | null;
  article_text: string | null;
  article_html: string | null;
  recipe_json: string | null;
  listened_percent: number;
  lat: number | null;
  lng: number | null;
};

type LocalMembership = { item_id: string | null; folder_id: string | null; added_at: number };
type LocalSubstitution = {
  id: string | null;
  find: string;
  replace: string;
  case_sensitive: number;
  created_at: number;
};

export type SyncSeedCounts = {
  folders: number;
  items: number;
  memberships: number;
  substitutions: number;
};

export type SyncIntegrityReport = {
  invalidItemTypes: number;
  orphanMemberships: number;
  duplicateActiveMemberships: number;
  activeLinksToDeletedFolders: number;
  emptyIds: number;
};

function assertValidId(value: string | null, kind: string): asserts value is string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Cannot enable sync: found a ${kind} with a missing or empty ID.`);
  }
}

function legacyMembershipId(itemId: string, folderId: string): string {
  // Length prefixes make this injective even if future ID formats contain ':' .
  return `legacy:${itemId.length}:${itemId}:${folderId.length}:${folderId}`;
}

/**
 * Install CRR tables in the existing local DB and seed them exactly once.
 * Caller must first load the packaged CR-SQLite extension on this connection.
 * Existing app tables are read-only inputs: this never rewrites or deletes them.
 * Returns null when the replica was already seeded.
 */
export function seedSyncReplica(
  db: SQLite.SQLiteDatabase,
  auRecipe = false,
): Promise<SyncSeedCounts | null> {
  return withAppDbWriteLock(() => seedSyncReplicaLocked(db, auRecipe));
}

async function seedSyncReplicaLocked(
  db: SQLite.SQLiteDatabase,
  auRecipe: boolean,
): Promise<SyncSeedCounts | null> {
  if (!CRSQLITE_SUPPORTED) throw new Error("CR-SQLite is currently packaged only for Android.");
  await db.execAsync(SYNC_SCHEMA_SQL);

  const prior = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM stash_sync_metadata WHERE key = ?",
    SYNC_INITIALIZED_KEY,
  );
  if (prior) {
    if (Number(prior.value) !== SYNC_SCHEMA_VERSION) {
      throw new Error(`Unsupported local sync seed version: ${prior.value}`);
    }
    return null;
  }

  const existing = await db.getFirstAsync<{
    folders: number;
    items: number;
    memberships: number;
    substitutions: number;
  }>(`SELECT
      (SELECT COUNT(*) FROM sync_folders) AS folders,
      (SELECT COUNT(*) FROM sync_items) AS items,
      (SELECT COUNT(*) FROM sync_item_folders) AS memberships,
      (SELECT COUNT(*) FROM sync_text_substitutions) AS substitutions`);
  if (existing && Object.values(existing).some((count) => count > 0)) {
    throw new Error("Sync tables already contain data but no local seed marker; refusing to overwrite or merge implicitly.");
  }

  const folders = await db.getAllAsync<LocalFolder>(
    "SELECT id, name, icon, created_at, archived_at, layout FROM folders ORDER BY id",
  );
  const items = await db.getAllAsync<LocalItem>(
    `SELECT id, type, uri, title, description, favicon_url, mime_type, created_at,
            archived_at, article_text, article_html, recipe_json, listened_percent, lat, lng
     FROM items ORDER BY id`,
  );
  const memberships = await db.getAllAsync<LocalMembership>(
    "SELECT item_id, folder_id, added_at FROM item_folders ORDER BY item_id, folder_id",
  );
  const substitutions = await db.getAllAsync<LocalSubstitution>(
    "SELECT id, find, replace, case_sensitive, created_at FROM text_substitutions ORDER BY id",
  );

  folders.forEach((row) => assertValidId(row.id, "folder"));
  items.forEach((row) => assertValidId(row.id, "item"));
  memberships.forEach((row) => {
    assertValidId(row.item_id, "membership item");
    assertValidId(row.folder_id, "membership folder");
  });
  substitutions.forEach((row) => assertValidId(row.id, "text substitution"));

  const folderIds = new Set(folders.map((row) => row.id));
  const itemIds = new Set(items.map((row) => row.id));
  for (const row of memberships) {
    if (!itemIds.has(row.item_id!) || !folderIds.has(row.folder_id!)) {
      throw new Error("Cannot enable sync: existing folder membership references a missing item or folder.");
    }
  }
  for (const row of items) {
    if (!["image", "url", "text", "file"].includes(row.type)) {
      throw new Error(`Cannot enable sync: item ${row.id} has unsupported type '${row.type}'.`);
    }
  }

  await db.withTransactionAsync(async () => {
    for (const row of folders) {
      await db.runAsync(
        `INSERT INTO sync_folders (id, name, icon, created_at, archived_at, layout, deleted)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [row.id!, row.name, row.icon, row.created_at, row.archived_at, row.layout],
      );
    }

    for (const row of items) {
      const portableContent = row.type === "url" || row.type === "text" ? row.uri : null;
      const mediaId = row.type === "image" || row.type === "file" ? row.id : null;
      await db.runAsync(
        `INSERT INTO sync_items (
           id, type, content, media_id, title, description, favicon_url, mime_type,
           created_at, archived_at, article_text, article_html, recipe_json,
           listened_percent, lat, lng
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          row.id!, row.type, portableContent, mediaId, row.title, row.description,
          row.favicon_url, row.mime_type, row.created_at, row.archived_at,
          row.article_text, row.article_html, row.recipe_json, row.listened_percent,
          row.lat, row.lng,
        ],
      );
    }

    for (const row of memberships) {
      const itemId = row.item_id!;
      const folderId = row.folder_id!;
      await db.runAsync(
        `INSERT INTO sync_item_folders (membership_id, item_id, folder_id, added_at)
         VALUES (?, ?, ?, ?)`,
        [legacyMembershipId(itemId, folderId), itemId, folderId, row.added_at],
      );
    }

    for (const row of substitutions) {
      await db.runAsync(
        `INSERT INTO sync_text_substitutions (id, find, replace, case_sensitive, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [row.id!, row.find, row.replace, row.case_sensitive, row.created_at],
      );
    }

    await db.runAsync(
      "INSERT INTO sync_user_settings (id, au_recipe) VALUES ('local-user', ?)",
      auRecipe ? 1 : 0,
    );
    await db.runAsync(
      "INSERT INTO stash_sync_metadata (key, value) VALUES (?, ?)",
      SYNC_INITIALIZED_KEY,
      String(SYNC_SCHEMA_VERSION),
    );
    await db.runAsync(
      "INSERT OR REPLACE INTO crsql_master (key, value) VALUES ('schema_name', 'stash-sync-v1')",
    );
    await db.execAsync(
      "INSERT OR REPLACE INTO crsql_master (key, value) VALUES ('schema_version', 1)",
    );
  });

  return {
    folders: folders.length,
    items: items.length,
    memberships: memberships.length,
    substitutions: substitutions.length,
  };
}

async function replicaReady(db: SQLite.SQLiteDatabase): Promise<boolean> {
  if (!CRSQLITE_SUPPORTED) return false;
  const table = await db.getFirstAsync<{ present: number }>(
    "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'stash_sync_metadata') AS present",
  );
  if (!table?.present) return false;
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM stash_sync_metadata WHERE key = ?",
    SYNC_INITIALIZED_KEY,
  );
  return Number(row?.value) === SYNC_SCHEMA_VERSION;
}

/** Keep an existing local row mirrored into the optional CRR tables. */
export async function mirrorLocalItem(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  if (!(await replicaReady(db))) return;
  const row = await db.getFirstAsync<LocalItem>(
    `SELECT id, type, uri, title, description, favicon_url, mime_type, created_at,
            archived_at, article_text, article_html, recipe_json, listened_percent, lat, lng
     FROM items WHERE id = ?`,
    id,
  );
  if (!row) {
    await db.runAsync("DELETE FROM sync_item_folders WHERE item_id = ?", id);
    await db.runAsync("DELETE FROM sync_items WHERE id = ?", id);
    return;
  }
  assertValidId(row.id, "item");
  await db.runAsync(
    `INSERT INTO sync_items (
       id, type, content, media_id, title, description, favicon_url, mime_type,
       created_at, archived_at, article_text, article_html, recipe_json,
       listened_percent, lat, lng
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type=excluded.type, content=excluded.content, media_id=excluded.media_id,
       title=excluded.title, description=excluded.description, favicon_url=excluded.favicon_url,
       mime_type=excluded.mime_type, created_at=excluded.created_at,
       archived_at=excluded.archived_at, article_text=excluded.article_text,
       article_html=excluded.article_html, recipe_json=excluded.recipe_json,
       listened_percent=excluded.listened_percent, lat=excluded.lat, lng=excluded.lng`,
    [
      row.id, row.type, row.type === "url" || row.type === "text" ? row.uri : null,
      row.type === "image" || row.type === "file" ? row.id : null,
      row.title, row.description, row.favicon_url, row.mime_type, row.created_at,
      row.archived_at, row.article_text, row.article_html, row.recipe_json,
      row.listened_percent, row.lat, row.lng,
    ],
  );
}

export async function mirrorLocalFolder(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  if (!(await replicaReady(db))) return;
  const row = await db.getFirstAsync<LocalFolder>(
    "SELECT id, name, icon, created_at, archived_at, layout FROM folders WHERE id = ?",
    id,
  );
  if (!row) {
    await db.runAsync("DELETE FROM sync_item_folders WHERE folder_id = ?", id);
    await db.runAsync("UPDATE sync_folders SET deleted = 1 WHERE id = ?", id);
    return;
  }
  assertValidId(row.id, "folder");
  await db.runAsync(
    `INSERT INTO sync_folders (id, name, icon, created_at, archived_at, layout, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(id) DO UPDATE SET
       name=excluded.name, icon=excluded.icon, created_at=excluded.created_at,
       archived_at=excluded.archived_at, layout=excluded.layout, deleted=0`,
    [row.id, row.name, row.icon, row.created_at, row.archived_at, row.layout],
  );
}

export async function mirrorLocalMembership(
  db: SQLite.SQLiteDatabase,
  itemId: string,
  folderId: string,
): Promise<void> {
  if (!(await replicaReady(db))) return;
  const local = await db.getFirstAsync<{ present: number }>(
    `SELECT EXISTS(SELECT 1 FROM item_folders WHERE item_id = ? AND folder_id = ?) AS present`,
    itemId,
    folderId,
  );
  if (!local?.present) {
    await db.runAsync("DELETE FROM sync_item_folders WHERE item_id = ? AND folder_id = ?", itemId, folderId);
    return;
  }
  const alreadyPresent = await db.getFirstAsync<{ present: number }>(
    `SELECT EXISTS(SELECT 1 FROM sync_item_folders WHERE item_id = ? AND folder_id = ?) AS present`,
    itemId,
    folderId,
  );
  if (alreadyPresent?.present) return;
  const row = await db.getFirstAsync<{ added_at: number }>(
    "SELECT added_at FROM item_folders WHERE item_id = ? AND folder_id = ?",
    itemId,
    folderId,
  );
  await db.runAsync(
    "INSERT INTO sync_item_folders (membership_id, item_id, folder_id, added_at) VALUES (?, ?, ?, ?)",
    randomId(),
    itemId,
    folderId,
    row?.added_at ?? Date.now(),
  );
}

export async function mirrorAuRecipeSetting(enabled: boolean): Promise<void> {
  const db = await getDb();
  await withAppDbWriteLock(async () => {
    if (!(await replicaReady(db))) return;
    await db.runAsync(
      "UPDATE sync_user_settings SET au_recipe = ? WHERE id = 'local-user'",
      enabled ? 1 : 0,
    );
  });
}

export async function mirrorLocalSubstitution(db: SQLite.SQLiteDatabase, id: string): Promise<void> {
  if (!(await replicaReady(db))) return;
  const row = await db.getFirstAsync<LocalSubstitution>(
    "SELECT id, find, replace, case_sensitive, created_at FROM text_substitutions WHERE id = ?",
    id,
  );
  if (!row) {
    await db.runAsync("DELETE FROM sync_text_substitutions WHERE id = ?", id);
    return;
  }
  assertValidId(row.id, "text substitution");
  await db.runAsync(
    `INSERT INTO sync_text_substitutions (id, find, replace, case_sensitive, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET find=excluded.find, replace=excluded.replace,
       case_sensitive=excluded.case_sensitive, created_at=excluded.created_at`,
    [row.id, row.find, row.replace, row.case_sensitive, row.created_at],
  );
}

/** Invalidate local projection authorization before applying any sync batch. */
export function beginSyncCycle(db: SQLite.SQLiteDatabase): Promise<void> {
  return withAppDbWriteLock(async () => {
    if (!(await replicaReady(db))) throw new Error("The local CR-SQLite replica has not been initialized.");
    await db.runAsync(
      "INSERT OR REPLACE INTO stash_sync_metadata (key, value) VALUES (?, '0')",
      SYNC_PROJECTION_READY_KEY,
    );
  });
}

/** Authorize one projection only after every change in a sync exchange has landed. */
export function markSyncSnapshotComplete(db: SQLite.SQLiteDatabase): Promise<void> {
  return withAppDbWriteLock(async () => {
    if (!(await replicaReady(db))) throw new Error("The local CR-SQLite replica has not been initialized.");
    await db.runAsync(
      "INSERT OR REPLACE INTO stash_sync_metadata (key, value) VALUES (?, '1')",
      SYNC_PROJECTION_READY_KEY,
    );
  });
}

/** Apply the current replicated projection; local media paths are retained, never taken from the network. */
export function projectSyncReplicaToLocal(db: SQLite.SQLiteDatabase): Promise<void> {
  return withAppDbWriteLock(() => projectSyncReplicaToLocalLocked(db));
}

async function projectSyncReplicaToLocalLocked(db: SQLite.SQLiteDatabase): Promise<void> {
  if (!(await replicaReady(db))) throw new Error("The local CR-SQLite replica has not been initialized.");
  const complete = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM stash_sync_metadata WHERE key = ?",
    SYNC_PROJECTION_READY_KEY,
  );
  if (complete?.value !== "1") {
    throw new Error("Refusing destructive local projection without a completed sync snapshot.");
  }
  await reconcileSyncRelationshipsLocked(db);

  await db.withTransactionAsync(async () => {
    const folders = await db.getAllAsync<LocalFolder & { deleted: number }>(
      "SELECT id, name, icon, created_at, archived_at, layout, deleted FROM sync_folders ORDER BY id",
    );
    for (const folder of folders) {
      if (folder.deleted) {
        await db.runAsync("DELETE FROM folders WHERE id = ?", folder.id!);
        continue;
      }
      const previous = await db.getFirstAsync<{ last_used_at: number }>(
        "SELECT last_used_at FROM folders WHERE id = ?",
        folder.id!,
      );
      await db.runAsync(
        `INSERT INTO folders (id, name, icon, created_at, last_used_at, archived_at, layout)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, icon=excluded.icon,
           created_at=excluded.created_at, archived_at=excluded.archived_at, layout=excluded.layout`,
        [folder.id!, folder.name, folder.icon ?? "📁", folder.created_at,
          previous?.last_used_at ?? folder.created_at, folder.archived_at, folder.layout],
      );
    }

    const items = await db.getAllAsync<LocalItem & { content: string | null; media_id: string | null }>(
      `SELECT id, type, content, media_id, title, description, favicon_url, mime_type,
              created_at, archived_at, article_text, article_html, recipe_json,
              listened_percent, lat, lng FROM sync_items ORDER BY id`,
    );
    for (const item of items) {
      if (!["image", "url", "text", "file"].includes(item.type)) {
        throw new Error(`Cannot project unsupported item type '${item.type}'.`);
      }
      const previous = await db.getFirstAsync<{ uri: string; thumbnail_path: string | null }>(
        "SELECT uri, thumbnail_path FROM items WHERE id = ?",
        item.id!,
      );
      // File bytes are not yet synced. Keep a device's existing local path;
      // defer showing a remote media-only item until its media is available.
      if ((item.type === "image" || item.type === "file") && !previous) continue;
      if ((item.type === "url" || item.type === "text") && item.content === null) {
        throw new Error(`Cannot project ${item.type} item '${item.id}' without portable content.`);
      }
      const uri = item.type === "url" || item.type === "text" ? item.content! : previous!.uri;
      await db.runAsync(
        `INSERT INTO items (
           id, type, uri, title, description, favicon_url, thumbnail_path, mime_type,
           created_at, archived_at, article_text, article_html, recipe_json,
           listened_percent, lat, lng
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type=excluded.type, uri=excluded.uri, title=excluded.title,
           description=excluded.description, favicon_url=excluded.favicon_url,
           mime_type=excluded.mime_type, created_at=excluded.created_at,
           archived_at=excluded.archived_at, article_text=excluded.article_text,
           article_html=excluded.article_html, recipe_json=excluded.recipe_json,
           listened_percent=excluded.listened_percent, lat=excluded.lat, lng=excluded.lng`,
        [item.id!, item.type, uri, item.title, item.description, item.favicon_url,
          previous?.thumbnail_path ?? null, item.mime_type, item.created_at,
          item.archived_at, item.article_text, item.article_html, item.recipe_json,
          item.listened_percent, item.lat, item.lng],
      );
    }

    await db.runAsync("DELETE FROM items WHERE id NOT IN (SELECT id FROM sync_items)");
    await db.runAsync("DELETE FROM item_folders");
    await db.runAsync(`
      INSERT OR IGNORE INTO item_folders (item_id, folder_id, added_at)
      SELECT m.item_id, m.folder_id, MIN(m.added_at)
      FROM sync_item_folders m
      JOIN sync_items i ON i.id = m.item_id
      JOIN sync_folders f ON f.id = m.folder_id AND f.deleted = 0
      JOIN items local_i ON local_i.id = i.id
      JOIN folders local_f ON local_f.id = f.id
      GROUP BY m.item_id, m.folder_id`);

    const substitutions = await db.getAllAsync<LocalSubstitution>(
      "SELECT id, find, replace, case_sensitive, created_at FROM sync_text_substitutions ORDER BY id",
    );
    for (const row of substitutions) {
      await db.runAsync(
        `INSERT INTO text_substitutions (id, find, replace, case_sensitive, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET find=excluded.find, replace=excluded.replace,
           case_sensitive=excluded.case_sensitive, created_at=excluded.created_at`,
        [row.id!, row.find, row.replace, row.case_sensitive, row.created_at],
      );
    }
    await db.runAsync(
      "DELETE FROM text_substitutions WHERE id NOT IN (SELECT id FROM sync_text_substitutions)",
    );
    // Consume this one-shot authorization; the sync driver must re-mark only
    // after a full exchange has completed successfully.
    await db.runAsync(
      "INSERT OR REPLACE INTO stash_sync_metadata (key, value) VALUES (?, '0')",
      SYNC_PROJECTION_READY_KEY,
    );
  });
}

/** Reconcile replicated relationship rows without physically deleting history. */
export function reconcileSyncRelationships(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  return withAppDbWriteLock(() => reconcileSyncRelationshipsLocked(db));
}

async function reconcileSyncRelationshipsLocked(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  if (!(await replicaReady(db))) throw new Error("The local CR-SQLite replica has not been initialized.");
  const complete = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM stash_sync_metadata WHERE key = ?",
    SYNC_PROJECTION_READY_KEY,
  );
  if (complete?.value !== "1") {
    throw new Error("Refusing relationship reconciliation without a completed sync snapshot.");
  }
  await db.withTransactionAsync(async () => {
    // A live item link is authoritative for folder survival, per the approved
    // add-wins policy. Folder deletion only tombstones membership generations
    // currently visible on the deleting peer.
    await db.runAsync(`
      UPDATE sync_folders SET deleted = 0
      WHERE deleted = 1 AND id IN (
        SELECT DISTINCT folder_id FROM sync_item_folders
        WHERE item_id IN (SELECT id FROM sync_items)
          AND folder_id IN (SELECT id FROM sync_folders)
      )`);

    // Replicated links to deleted/missing items cannot remain active.
    await db.runAsync(`
      DELETE FROM sync_item_folders
      WHERE item_id NOT IN (SELECT id FROM sync_items)`);

    // Keep memberships to a tombstoned folder in CRR state: the reconciliation
    // above revives the parent. No FK or physical purge is used here.
  });
}

export async function inspectSyncIntegrity(
  db: SQLite.SQLiteDatabase,
): Promise<SyncIntegrityReport> {
  const row = await db.getFirstAsync<SyncIntegrityReport>(`
    SELECT
      (SELECT COUNT(*) FROM sync_items WHERE type NOT IN ('image','url','text','file')) AS invalidItemTypes,
      (SELECT COUNT(*) FROM sync_item_folders m
       WHERE NOT EXISTS (SELECT 1 FROM sync_items i WHERE i.id = m.item_id)
          OR NOT EXISTS (SELECT 1 FROM sync_folders f WHERE f.id = m.folder_id)) AS orphanMemberships,
      (SELECT COUNT(*) FROM (
         SELECT item_id, folder_id FROM sync_item_folders
         GROUP BY item_id, folder_id HAVING COUNT(*) > 1
       )) AS duplicateActiveMemberships,
      (SELECT COUNT(*) FROM sync_item_folders m JOIN sync_folders f ON f.id = m.folder_id
       WHERE f.deleted = 1) AS activeLinksToDeletedFolders,
      (SELECT
         (SELECT COUNT(*) FROM sync_folders WHERE id = '') +
         (SELECT COUNT(*) FROM sync_items WHERE id = '') +
         (SELECT COUNT(*) FROM sync_item_folders WHERE membership_id = '' OR item_id = '' OR folder_id = '') +
         (SELECT COUNT(*) FROM sync_text_substitutions WHERE id = '')
      ) AS emptyIds`);
  if (!row) throw new Error("Could not inspect sync database integrity.");
  return row;
}

export async function loadCrsqliteExtension(db: SQLite.SQLiteDatabase): Promise<void> {
  await ensureCrsqliteLoaded(db);
}

/** Opt-in development gate: initialize only the local replica tables, without connecting to a server. */
export async function prepareCurrentStashReplica(auRecipe = false): Promise<{
  seeded: SyncSeedCounts | null;
  integrity: SyncIntegrityReport;
}> {
  const db = await getDb();
  await loadCrsqliteExtension(db);
  const seeded = await seedSyncReplica(db, auRecipe);
  // A local seed is itself a complete snapshot; future network sync must clear
  // and re-mark this authorization around each full exchange.
  await markSyncSnapshotComplete(db);
  await reconcileSyncRelationships(db);
  const integrity = await inspectSyncIntegrity(db);
  if (integrity.invalidItemTypes || integrity.orphanMemberships || integrity.activeLinksToDeletedFolders || integrity.emptyIds) {
    throw new Error(`Sync replica integrity check failed: ${JSON.stringify(integrity)}`);
  }
  return { seeded, integrity };
}
