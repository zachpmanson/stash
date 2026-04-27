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
      archived_at INTEGER DEFAULT NULL
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
      article_text TEXT
    );

    CREATE TABLE IF NOT EXISTS item_folders (
      item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
      folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
      added_at INTEGER NOT NULL,
      PRIMARY KEY (item_id, folder_id)
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

  // Seed default Inbox folder if empty
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM folders WHERE archived_at IS NULL",
  );
  if (!row || row.count === 0) {
    const now = Date.now();
    await db.runAsync("INSERT OR IGNORE INTO folders (id, name, icon, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)", [
      "inbox",
      "Inbox",
      "📥",
      now,
      now,
    ]);
  }
}
