import { getDb } from "./database";
import { Folder } from "../types";
import { countGraphemes } from "unicode-segmenter/grapheme";

export async function getFolders(includeArchived = false): Promise<Folder[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Folder>(
    includeArchived
      ? `SELECT f.*, (
           SELECT COUNT(*) FROM item_folders if2
           JOIN items i ON i.id = if2.item_id
           WHERE if2.folder_id = f.id AND i.archived_at IS NULL
         ) as item_count FROM folders f ORDER BY f.last_used_at DESC`
      : `SELECT f.*, (
           SELECT COUNT(*) FROM item_folders if2
           JOIN items i ON i.id = if2.item_id
           WHERE if2.folder_id = f.id AND i.archived_at IS NULL
         ) as item_count FROM folders f WHERE f.archived_at IS NULL ORDER BY f.last_used_at DESC`,
  );
  return rows;
}

export async function getArchivedFolders(): Promise<Folder[]> {
  const db = await getDb();
  return db.getAllAsync<Folder>(
    `SELECT f.*, (
       SELECT COUNT(*) FROM item_folders if2
       JOIN items i ON i.id = if2.item_id
       WHERE if2.folder_id = f.id
     ) as item_count FROM folders f WHERE f.archived_at IS NOT NULL ORDER BY f.archived_at DESC`,
  );
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

export async function createFolder(id: string, name: string, icon?: string): Promise<Folder> {
  const db = await getDb();
  const now = Date.now();
  const resolvedIcon = icon ?? defaultIcon(name);
  await db.runAsync("INSERT INTO folders (id, name, icon, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)", [
    id,
    name.trim(),
    resolvedIcon,
    now,
    now,
  ]);
  return { id, name: name.trim(), icon: resolvedIcon, created_at: now, last_used_at: now, archived_at: null };
}

export async function updateFolderName(id: string, name: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE folders SET name = ? WHERE id = ?", [name.trim(), id]);
}

export async function updateFolderIcon(id: string, icon: string): Promise<void> {
  console.log({ len: countGraphemes(icon), icon });
  if (countGraphemes(icon) !== 1) throw new Error("Icon must be single emoji");
  const db = await getDb();
  await db.runAsync("UPDATE folders SET icon = ? WHERE id = ?", [icon, id]);
}

export async function touchFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE folders SET last_used_at = ? WHERE id = ?", [Date.now(), id]);
}

export async function archiveFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE folders SET archived_at = ? WHERE id = ?", [Date.now(), id]);
}

export async function unarchiveFolder(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync("UPDATE folders SET archived_at = NULL WHERE id = ?", [id]);
}

export async function deleteFolder(id: string): Promise<void> {
  const db = await getDb();
  // Remove item_folder links; items themselves are preserved (orphaned items still exist)
  await db.runAsync("DELETE FROM item_folders WHERE folder_id = ?", [id]);
  await db.runAsync("DELETE FROM folders WHERE id = ?", [id]);
}
