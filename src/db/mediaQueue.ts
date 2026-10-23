import type * as SQLite from "expo-sqlite";
import { withAppDb, assertAppDbWritableOwned, getAppDbGeneration, assertAppDbGenerationOwned } from "./database";
import { localImageExists, uploadLocalImage, downloadPrivateImage, MediaTransferError, type ImageDescriptor } from "./mediaFiles";
export type MediaQueueStatus = { pending: number; errors: number; message?: string };
type Job = { item_id: string; direction: "upload" | "download"; source_uri: string | null; attempts: number };
const TABLE = "stash_media_queue_v1";
async function initialize(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    account TEXT NOT NULL, item_id TEXT NOT NULL, direction TEXT NOT NULL,
    source_uri TEXT, state TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
    next_retry INTEGER, message TEXT, PRIMARY KEY(account,item_id)
  ); CREATE TABLE IF NOT EXISTS stash_media_local_v1 (
    item_id TEXT PRIMARY KEY NOT NULL, original_sha TEXT NOT NULL, uri TEXT NOT NULL
  );`);
}
export async function retryStashImages(): Promise<void> {
  await withAppDb(async db => {
    await assertAppDbWritableOwned(db); await initialize(db);
    await db.runAsync(`UPDATE ${TABLE} SET state='queued',next_retry=0,message=NULL WHERE state!='complete'`);
  });
}
/** One serial transfer, outside DB ownership, after metadata recovery completes.
 * The owning sync session awaits this function and cancels/drains it on restore.
 * Jobs/attempts survive restart; secrets, auth headers and bytes never enter SQL.
 */
export async function runStashMediaCycle(base: URL, username: string, authorization: string, signal: AbortSignal, reconnect = false): Promise<{ status: MediaQueueStatus; projected: boolean }> {
  const account = JSON.stringify([base.toString(), username]);
  const generation = getAppDbGeneration();
  const owned = <T>(fn: (db: SQLite.SQLiteDatabase) => Promise<T>) => withAppDb(async db => {
    if (signal.aborted) throw new Error("Image session cancelled");
    assertAppDbGenerationOwned(generation); await assertAppDbWritableOwned(db);
    return fn(db);
  });
  let projected = false;
  const job = await owned(async db => {
    await initialize(db);
    // Queue rows are device-local, not CRRs. Deletion cancels work but never
    // removes retained local originals or uploaded server objects.
    await db.runAsync(`DELETE FROM ${TABLE} WHERE account=? AND item_id NOT IN (SELECT id FROM sync_items WHERE type='image' AND media_id=id)`, account);
    const rows = await db.getAllAsync<{ id: string; uri: string | null }>(`SELECT s.id,COALESCE(i.uri,l.uri) AS uri FROM sync_items s
      LEFT JOIN items i ON i.id=s.id LEFT JOIN stash_media_local_v1 l ON l.item_id=s.id
      WHERE s.type='image' AND s.media_id=s.id AND (?=1 OR NOT EXISTS(
        SELECT 1 FROM ${TABLE} q WHERE q.account=? AND q.item_id=s.id))`, reconnect ? 1 : 0, account);
    for (const row of rows) {
      const local = row.uri && localImageExists(row.uri);
      if (reconnect) await db.runAsync(`UPDATE ${TABLE} SET state='queued',direction=?,source_uri=?,next_retry=0 WHERE account=? AND item_id=? AND state='complete'`,
        local ? "upload" : "download", local ? row.uri : null, account, row.id);
      await db.runAsync(`INSERT OR IGNORE INTO ${TABLE}(account,item_id,direction,source_uri,next_retry) VALUES (?,?,?,?,0)`,
        account, row.id, local ? "upload" : "download", local ? row.uri : null);
    }
    return db.getFirstAsync<Job>(`SELECT item_id,direction,source_uri,attempts FROM ${TABLE}
      WHERE account=? AND state!='complete' AND (next_retry IS NOT NULL AND next_retry<=?)
      ORDER BY attempts,item_id LIMIT 1`, account, Date.now());
  });
  if (job) {
    const controller = new AbortController(); const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
    const timeout = setTimeout(abort, 60_000);
    const endpoint = new URL(`api/media/items/${encodeURIComponent(job.item_id)}/`, base);
    try {
      // A 404 is expected when metadata/bytes are still in transit. HTTP auth
      // stays separate from CR-SQLite; convergence alone never marks jobs done.
      const response = await fetch(new URL("status", endpoint), { headers: { Authorization: authorization, "X-Stash-Request": "1" }, signal: controller.signal, redirect: "error" });
      if (!response.ok) throw new MediaTransferError(`Image status HTTP ${response.status}`, response.status);
      const descriptor = await response.json() as ImageDescriptor & { state: string };
      let downloaded: { uri: string; sha: string } | null = null;
      if (job.direction === "upload") {
        // Always verify the local bytes on retries, even when the server already
        // has a manifest, so a conflicting image cannot be silently accepted.
        await uploadLocalImage(job.source_uri!, new URL("original", endpoint).toString(), authorization, controller.signal);
      } else {
        if (descriptor.state !== "available") throw new MediaTransferError("Image bytes pending on the server", 404);
        const uri = await downloadPrivateImage(new URL("original", endpoint).toString(), descriptor, authorization, controller.signal);
        downloaded = { uri, sha: descriptor.sha256 };
      }
      if (controller.signal.aborted) throw new MediaTransferError("Image transfer cancelled");
      await owned(async db => {
        // Check live replicated identity again after network/FS awaits. Never
        // create metadata or publish paths for an item deleted during transfer.
        const item = await db.getFirstAsync<{ id: string }>("SELECT id FROM sync_items WHERE id=? AND type='image' AND media_id=id", job.item_id);
        if (!item) { await db.runAsync(`DELETE FROM ${TABLE} WHERE account=? AND item_id=?`, account, job.item_id); return; }
        await db.withTransactionAsync(async () => {
          if (downloaded) {
            await db.runAsync("INSERT OR REPLACE INTO stash_media_local_v1(item_id,original_sha,uri) VALUES (?,?,?)", job.item_id, downloaded.sha, downloaded.uri);
            // Projection is a separate metadata barrier. Its normal next pass
            // consumes this verified mapping, without replicating a local path.
            projected = true;
          }
          await db.runAsync(`UPDATE ${TABLE} SET state='complete',next_retry=NULL,message=NULL WHERE account=? AND item_id=?`, account, job.item_id);
        });
      });
    } catch (error) {
      if (signal.aborted) throw error;
      const code = error instanceof MediaTransferError ? error.status : 0;
      const terminal = [409, 413, 415].includes(code);
      const message = code === 404 ? "Waiting for image metadata or bytes" : code === 401 || code === 403 ? "Image authentication rejected; reconnect" :
        terminal ? `Image unsupported or conflicting (HTTP ${code}); original retained` : "Image transfer failed; retry scheduled";
      await owned(db => db.runAsync(`UPDATE ${TABLE} SET state=?,attempts=attempts+1,next_retry=?,message=? WHERE account=? AND item_id=?`,
        terminal ? "error" : "retry", terminal ? null : Date.now() + Math.min(300_000, 2000 * 2 ** Math.min(job.attempts, 8)), message, account, job.item_id));
    } finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
  }
  const status = await owned(async db => {
    const counts = await db.getFirstAsync<{ pending: number; errors: number }>(`SELECT COUNT(*) AS pending,
      COALESCE(SUM(CASE WHEN state IN ('error','retry') THEN 1 ELSE 0 END),0) AS errors FROM ${TABLE} WHERE account=? AND state!='complete'`, account);
    const last = await db.getFirstAsync<{ message: string }>(`SELECT message FROM ${TABLE} WHERE account=? AND message IS NOT NULL ORDER BY attempts DESC LIMIT 1`, account);
    return { pending: counts?.pending ?? 0, errors: counts?.errors ?? 0, ...(last?.message ? { message: last.message } : {}) };
  });
  return { status, projected };
}
