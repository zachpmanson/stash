import { getDb } from './database';
import { StashItem } from '../types';
import { touchFolder } from './folders';

interface RawItem {
  id: string;
  type: StashItem['type'];
  uri: string;
  title: string | null;
  description: string | null;
  favicon_url: string | null;
  thumbnail_path: string | null;
  mime_type: string | null;
  created_at: number;
  archived_at: number | null;
  article_text: string | null;
  article_html: string | null;
}

export async function getItemsInFolder(folderId: string): Promise<StashItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawItem>(
    `SELECT i.* FROM items i
     JOIN item_folders if2 ON if2.item_id = i.id
     WHERE if2.folder_id = ? AND i.archived_at IS NULL
     ORDER BY i.created_at DESC`,
    [folderId]
  );
  return rows.map(attachFolderIds);
}

export async function getArchivedItems(): Promise<StashItem[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawItem>(
    'SELECT * FROM items WHERE archived_at IS NOT NULL ORDER BY archived_at DESC'
  );
  return rows.map(attachFolderIds);
}

export async function getItemById(id: string): Promise<StashItem | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<RawItem>('SELECT * FROM items WHERE id = ?', [id]);
  if (!row) return null;
  const item = attachFolderIds(row);
  const folderRows = await db.getAllAsync<{ folder_id: string }>(
    'SELECT folder_id FROM item_folders WHERE item_id = ?',
    [id]
  );
  item.folder_ids = folderRows.map(r => r.folder_id);
  return item;
}

export async function saveItem(item: Omit<StashItem, 'archived_at'>, folderIds: string[]): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO items (id, type, uri, title, description, favicon_url, thumbnail_path, mime_type, created_at, article_text, article_html)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [item.id, item.type, item.uri, item.title ?? null, item.description ?? null,
     item.favicon_url ?? null, item.thumbnail_path ?? null, item.mime_type ?? null, now,
     item.article_text ?? null, item.article_html ?? null]
  );
  for (const folderId of folderIds) {
    await db.runAsync(
      'INSERT OR IGNORE INTO item_folders (item_id, folder_id, added_at) VALUES (?, ?, ?)',
      [item.id, folderId, now]
    );
    await touchFolder(folderId);
  }
}

export async function addItemToFolder(itemId: string, folderId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT OR IGNORE INTO item_folders (item_id, folder_id, added_at) VALUES (?, ?, ?)',
    [itemId, folderId, Date.now()]
  );
  await touchFolder(folderId);
}

export async function removeItemFromFolder(itemId: string, folderId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'DELETE FROM item_folders WHERE item_id = ? AND folder_id = ?',
    [itemId, folderId]
  );
}

export async function archiveItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE items SET archived_at = ? WHERE id = ?', [Date.now(), id]);
}

export async function unarchiveItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE items SET archived_at = NULL WHERE id = ?', [id]);
}

export async function updateItemArticleHtml(id: string, html: string | null): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE items SET article_html = ?, article_text = NULL WHERE id = ?', [html, id]);
}

export async function deleteItem(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM item_folders WHERE item_id = ?', [id]);
  await db.runAsync('DELETE FROM items WHERE id = ?', [id]);
}

function attachFolderIds(row: RawItem): StashItem {
  return { ...row, folder_ids: [] };
}
