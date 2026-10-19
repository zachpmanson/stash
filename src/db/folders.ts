import { withAppDb } from "./database";
import { Folder, FolderLayout } from "../types";
import { countGraphemes } from "unicode-segmenter/grapheme";
import { mirrorLocalFolderOwned } from "./syncReplica";

export async function getFolders(includeArchived = false): Promise<Folder[]> {
  return withAppDb(async (db) => {
    const rows = await db.getAllAsync<Folder>(
      includeArchived
        ? `SELECT f.*, (
             SELECT COUNT(*) FROM item_folders if2
             JOIN items i ON i.id = if2.item_id
             WHERE if2.folder_id = f.id AND i.archived_at IS NULL
           ) as item_count
           FROM folders f
           ORDER BY f.last_used_at DESC`
        : `SELECT f.*, (
             SELECT COUNT(*) FROM item_folders if2
             JOIN items i ON i.id = if2.item_id
             WHERE if2.folder_id = f.id AND i.archived_at IS NULL
           ) as item_count
           FROM folders f
           WHERE f.archived_at IS NULL
           ORDER BY f.last_used_at DESC`,
    );
    return rows;
  });
}

export async function getArchivedFolders(): Promise<Folder[]> {
  return withAppDb(async (db) => {
    return db.getAllAsync<Folder>(
      `SELECT f.*, (
         SELECT COUNT(*) FROM item_folders if2
         JOIN items i ON i.id = if2.item_id
         WHERE if2.folder_id = f.id
       ) as item_count FROM folders f WHERE f.archived_at IS NOT NULL ORDER BY f.archived_at DESC`,
    );
  });
}

const ICON_MAP: Record<string, string> = {
  a: "🅰️",
  b: "📚",
  c: "💾",
  d: "📄",
  e: "✉️",
  f: "📁",
  g: "🎮",
  h: "🏠",
  i: "💡",
  j: "📓",
  k: "🔑",
  l: "🔗",
  m: "🎵",
  n: "📰",
  o: "🌐",
  p: "📌",
  q: "❓",
  r: "🔴",
  s: "⭐",
  t: "🏷️",
  u: "🔵",
  v: "🎬",
  w: "🌊",
  x: "❌",
  y: "💛",
  z: "⚡",
};

function defaultIcon(name: string): string {
  const first = name.trim()[0]?.toLowerCase() ?? "";
  return ICON_MAP[first] ?? "📁";
}

export async function getFolderById(id: string): Promise<Folder | null> {
  return withAppDb(async (db) => {
    return db.getFirstAsync<Folder>("SELECT * FROM folders WHERE id = ?", [id]);
  });
}

export async function createFolder(id: string, name: string, icon?: string, layout?: FolderLayout): Promise<Folder> {
  return withAppDb(async (db) => {
    const now = Date.now();
    const resolvedIcon = icon ?? defaultIcon(name);
    const resolvedLayout = layout ?? "grid";
    await db.withTransactionAsync( async () => {
      await db.runAsync(
        "INSERT INTO folders (id, name, icon, created_at, last_used_at, layout) VALUES (?, ?, ?, ?, ?, ?)",
        [id, name.trim(), resolvedIcon, now, now, resolvedLayout],
      );
      await mirrorLocalFolderOwned(db, id);
    });
    return {
      id,
      name: name.trim(),
      icon: resolvedIcon,
      created_at: now,
      last_used_at: now,
      archived_at: null,
      layout: resolvedLayout,
    };
  });
}

export async function updateFolderName(id: string, name: string): Promise<void> {
  return withAppDb(async (db) => {
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE folders SET name = ? WHERE id = ?", [name.trim(), id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}

export async function updateFolderIcon(id: string, icon: string): Promise<void> {
  return withAppDb(async (db) => {
    console.log({ len: countGraphemes(icon), icon });
    if (countGraphemes(icon) !== 1) throw new Error("Icon must be single emoji");
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE folders SET icon = ? WHERE id = ?", [icon, id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}

export async function updateFolderLayout(id: string, layout: FolderLayout): Promise<void> {
  return withAppDb(async (db) => {
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE folders SET layout = ? WHERE id = ?", [layout, id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}

export async function touchFolder(id: string): Promise<void> {
  return withAppDb(async (db) => {
    await (async () => {
      await db.runAsync("UPDATE folders SET last_used_at = ? WHERE id = ?", [Date.now(), id]);
    })();
  });
}

export async function archiveFolder(id: string): Promise<void> {
  return withAppDb(async (db) => {
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE folders SET archived_at = ? WHERE id = ?", [Date.now(), id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}

export async function unarchiveFolder(id: string): Promise<void> {
  return withAppDb(async (db) => {
    await db.withTransactionAsync( async () => {
      await db.runAsync("UPDATE folders SET archived_at = NULL WHERE id = ?", [id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}

export async function deleteFolder(id: string): Promise<void> {
  return withAppDb(async (db) => {
    // Preserve the user-visible local behavior. The replicated copy uses a folder
    // tombstone and removes only generations observed by this device.
    await db.withTransactionAsync( async () => {
      await db.runAsync("DELETE FROM item_folders WHERE folder_id = ?", [id]);
      await db.runAsync("DELETE FROM folders WHERE id = ?", [id]);
      await mirrorLocalFolderOwned(db, id);
    });
  });
}
