import * as SQLite from "expo-sqlite";

let db: SQLite.SQLiteDatabase | null = null;
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return Promise.resolve(db);
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("stash.db")
      .then(async (database) => {
        await initSchema(database);
        db = database;
        return db;
      })
      .catch((e) => {
        dbPromise = null;
        console.error(e);
        throw e;
      });
  }
  return dbPromise;
}

/**
 * Closes the open database connection and resets the cached singleton so the
 * next {@link getDb} call reopens from disk. Used by restore to swap in a
 * fresh database file.
 */
export async function closeDb(): Promise<void> {
  const current = db;
  db = null;
  dbPromise = null;
  if (current) {
    try {
      await current.closeAsync();
    } catch {
      // ignore close errors; the singleton is already reset
    }
  }
}

/**
 * Flushes the WAL journal into the main database file so the on-disk file is
 * a complete, self-contained copy (required for a valid backup).
 */
export async function checkpointDb(): Promise<void> {
  const database = await getDb();
  try {
    await database.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch {
    // non-fatal; serialize-based backup still captures committed data
  }
}

async function initSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS folders (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      archived_at INTEGER DEFAULT NULL,
      layout TEXT NOT NULL DEFAULT 'grid'
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('image','url','text','file')),
      uri TEXT NOT NULL,
      title TEXT,
      description TEXT,
      favicon_url TEXT,
      thumbnail_path TEXT,
      mime_type TEXT,
      created_at INTEGER NOT NULL,
      archived_at INTEGER DEFAULT NULL,
      article_text TEXT,
      article_html TEXT,
      listened_percent INTEGER NOT NULL DEFAULT 0,
      lat REAL,
      lng REAL
    );

    CREATE TABLE IF NOT EXISTS item_folders (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, folder_id)
    );

    CREATE TABLE IF NOT EXISTS text_substitutions (
      id TEXT PRIMARY KEY,
      find TEXT NOT NULL,
      replace TEXT NOT NULL,
      case_sensitive INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_item_folders_folder ON item_folders(folder_id);
    CREATE INDEX IF NOT EXISTS idx_item_folders_item ON item_folders(item_id);
    CREATE INDEX IF NOT EXISTS idx_items_created ON items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_folders_last_used ON folders(last_used_at DESC);
  `);

  const cols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(items)");
  if (!cols.some((c) => c.name === "article_text")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN article_text TEXT");
  }
  if (!cols.some((c) => c.name === "article_html")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN article_html TEXT");
  }
  if (!cols.some((c) => c.name === "listened_percent")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN listened_percent INTEGER NOT NULL DEFAULT 0");
  }
  if (!cols.some((c) => c.name === "recipe_json")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN recipe_json TEXT");
  }
  if (!cols.some((c) => c.name === "lat")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN lat REAL");
  }
  if (!cols.some((c) => c.name === "lng")) {
    await db.execAsync("ALTER TABLE items ADD COLUMN lng REAL");
  }

  // Migrate folders table: add icon column if missing
  const folderCols = await db.getAllAsync<{ name: string }>("PRAGMA table_info(folders)");
  if (!folderCols.some((c) => c.name === "icon")) {
    await db.execAsync("ALTER TABLE folders ADD COLUMN icon TEXT NOT NULL DEFAULT '📁'");
  }
  if (!folderCols.some((c) => c.name === "layout")) {
    await db.execAsync("ALTER TABLE folders ADD COLUMN layout TEXT NOT NULL DEFAULT 'grid'");
  }

  // Seed default Inbox folder if empty
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM folders WHERE archived_at IS NULL",
  );
  if (!row || row.count === 0) {
    const now = Date.now();
    await db.runAsync(
      "INSERT OR IGNORE INTO folders (id, name, icon, created_at, last_used_at, layout) VALUES (?, ?, ?, ?, ?, ?)",
      ["inbox", "Inbox", "📥", now, now, "list"],
    );
  }
}
