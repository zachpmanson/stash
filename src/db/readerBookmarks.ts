import { assertAppDbGenerationOwned, getAppDbGeneration, withAppDb, withAppDbMutation } from "./database";
import { parseReaderBookmark, ReaderBookmark } from "../utils/readerBookmark";

export function getReaderBookmark(itemId: string): Promise<ReaderBookmark | null> {
  return withAppDb(async db => {
    const row = await db.getFirstAsync<{ bookmark_json: string }>(
      "SELECT bookmark_json FROM reader_bookmarks WHERE item_id = ?", itemId,
    );
    return row ? parseReaderBookmark(row.bookmark_json) : null;
  });
}

export function saveReaderBookmark(itemId: string, bookmark: ReaderBookmark): Promise<void> {
  const generation = getAppDbGeneration();
  const json = JSON.stringify(bookmark);
  if (!itemId || !parseReaderBookmark(json)) return Promise.reject(new Error("Invalid reading bookmark."));
  return withAppDbMutation(async db => {
    assertAppDbGenerationOwned(generation);
    await db.runAsync(
      "INSERT INTO reader_bookmarks (item_id, bookmark_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(item_id) DO UPDATE SET bookmark_json = excluded.bookmark_json, updated_at = excluded.updated_at",
      itemId, json, Date.now(),
    );
  });
}
