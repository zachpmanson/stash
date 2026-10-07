// Generated-copy runtime form of ../schemas/stash-sync-v1.sql.
// test/stash-schema-matches-sql.test.mjs guards against drift.
export const STASH_SCHEMA_SQL = String.raw`-- DESIGN CANDIDATE ONLY. Not loaded by the Expo app or Naboo service.
-- CR-SQLite 0.16.3 candidate schema for Stash single-tenant sync.
-- Keep this in lock-step with app/server schemas if/when promoted.
-- No FOREIGN KEY or CHECK constraints: enforce those invariants in application
-- reconciliation/validation because replication applies individual row changes.

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

-- One row per add-generation, not one mutable row per item/folder pair.
-- Re-adding a removed pair creates a fresh membership_id. The client projects
-- active generations to one logical local item_folders row per pair.
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
`;
