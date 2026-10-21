import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { copyAsync } from "expo-file-system/legacy";
import { zip, unzip } from "react-native-zip-archive";
import * as SQLite from "expo-sqlite";
import type { SQLiteDatabase } from "expo-sqlite";
import { checkpointDbOwned, withAppDb, withAppDbReplacement, closeTemporaryDatabase, ensureCrsqliteLoaded, RESTORE_INSTALL_MARKER } from "../db/database";
import { withStashSyncRestoreLock } from "../db/syncClient";
import { assertRecoveryConfigurationOwned, buildFreshRestoreOwned, classifyRestoreSourceOwned, RESTORE_MEDIA_SCHEMA } from "../db/restoreMerge";
import { Folder, StashItem } from "../types";

const DB_FILENAME = "stash.db";
// The stashed media/files live in <document>/stash/ (see src/utils/fileUtils.ts).
// We keep the same name both where they're read from and the zip-internal folder.
const FILES_DIR_NAME = "stash";
const MANIFEST_NAME = "manifest.json";
const BACKUP_FORMAT = 1;
const ZIP_MIME = "application/zip";

export type BackupManifest = {
  format: number;
  createdAt: number;
  app: string;
  folderCount: number;
  itemCount: number;
};

function makeStagingId(): string {
  return `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Builds a backup zip containing the database plus every stashed file, then
 * shares it via the OS share sheet. Returns the generated zip path.
 */
export async function createBackup(): Promise<string> {
  const stagingId = makeStagingId();
  const stagingRoot = new Directory(Paths.cache, `stash-backup-${stagingId}`);
  stagingRoot.create({ intermediates: true, idempotent: true });

  // Keep snapshot/counts/files together and exclude restore until staging is ready.
  await withAppDb(async (database) => {
    await checkpointDbOwned(database);
    await copyDatabaseFileOwned(database, new Directory(stagingRoot));
    const srcFiles = new Directory(Paths.document, FILES_DIR_NAME);
    if (srcFiles.exists) {
      copyDirContents(srcFiles, new Directory(stagingRoot, FILES_DIR_NAME));
    }
    const manifest = await buildManifestOwned(database);
    const manifestFile = new File(stagingRoot, MANIFEST_NAME);
    manifestFile.create({ overwrite: true, intermediates: true });
    manifestFile.write(JSON.stringify(manifest, null, 2));
  });

  // 4. Zip the staging dir into a single portable archive.
  const zipPath = new File(Paths.cache, `stash-backup-${stagingId}.zip`);
  await zip(stagingRoot.uri, zipPath.uri, 9);

  // Clean up staging (zip is already written).
  try {
    stagingRoot.delete();
  } catch {
    // non-critical
  }

  return zipPath.uri;
}

/**
 * Shares a generated backup zip via the OS share sheet.
 */
export async function shareBackup(zipPath: string): Promise<void> {
  await Sharing.shareAsync(zipPath, {
    mimeType: ZIP_MIME,
    dialogTitle: "Share Stash backup",
  });
}

/**
 * Picks a backup zip and restores the database + files from it.
 * Replaces local app data with a fresh database. Seeded history merges with
 * the server before editing resumes. Existing device media/rollback are retained.
 */
export async function restoreBackup(fileUri: string): Promise<BackupManifest & { recoveryPending: boolean }> {
  if (!fileUri) {
    throw new Error("No backup file selected.");
  }

  const stagingId = makeStagingId();
  const stagingRoot = new Directory(Paths.cache, `stash-restore-${stagingId}`);
  stagingRoot.create({ intermediates: true, idempotent: true });

  try {
    // 1. Unzip the selected file into staging.
    await unzip(fileUri, stagingRoot.uri);

    // 2. Validate the manifest.
    const manifestFile = new File(stagingRoot, MANIFEST_NAME);
    if (!manifestFile.exists) {
      throw new Error("Not a Stash backup (missing manifest).");
    }
    const manifest = JSON.parse(await manifestFile.text()) as BackupManifest;
    if (!manifest || manifest.app !== "stash" || manifest.format !== BACKUP_FORMAT) {
      throw new Error("Unsupported or invalid Stash backup.");
    }

    // Validate before beginning destructive replacement.
    if (!new File(stagingRoot, DB_FILENAME).exists) {
      throw new Error("Backup is missing the database file.");
    }
    const freshRoot = new Directory(stagingRoot, "fresh");
    freshRoot.create();
    const preparedRoot = new Directory(stagingRoot, "install");
    preparedRoot.create();
    let source: SQLiteDatabase | undefined;
    let fresh: SQLiteDatabase | undefined;
    let recoveryPending = false;
    const mediaRoot = new Directory(stagingRoot, "media");
    const namespace = `restore-${stagingId}`;
    const rollback = new Directory(Paths.document, `stash-rollback-${stagingId}`);
    const installMarker = new File(Paths.document, RESTORE_INSTALL_MARKER);
    try {
      source = await SQLite.openDatabaseAsync(DB_FILENAME, { useNewConnection: true }, stagingRoot.uri);
      fresh = await SQLite.openDatabaseAsync(DB_FILENAME, { useNewConnection: true }, freshRoot.uri);
      await classifyRestoreSourceOwned(source);
      return await withStashSyncRestoreLock(() => withAppDbReplacement(
        async () => {
          // Persistent crash barrier. Startup must not initialize a partial install.
          installMarker.create({ overwrite: false });
          installMarker.write(JSON.stringify({ rollback: rollback.uri }));
          if (mediaRoot.exists) copyDirContents(mediaRoot, new Directory(Paths.document, FILES_DIR_NAME, namespace));
          await replaceDatabase(preparedRoot);
        },
        async (database) => {
          const check = await database.getAllAsync<Record<string, unknown>>("PRAGMA integrity_check");
          if (check.length !== 1 || Object.values(check[0])[0] !== "ok") throw new Error("Installed restore failed integrity validation.");
          installMarker.delete();
          return { ...manifest, recoveryPending };
        },
        async (current) => {
          const seeded = await current.getFirstAsync<{ value: string }>("SELECT value FROM stash_sync_metadata WHERE key = 'stash_sync_seed_version'").catch(() => null);
          if (seeded) {
            await ensureCrsqliteLoaded(current);
            await assertRecoveryConfigurationOwned(current);
          }
          if (rollback.exists || new Directory(Paths.document, FILES_DIR_NAME, namespace).exists) {
            throw new Error("Restore staging/rollback path already exists; refusing to overwrite media.");
          }
          ({ recoveryPending } = await buildFreshRestoreOwned(source!, fresh!));
          const closingSource = source;
          source = undefined;
          await closeTemporaryDatabase(closingSource!);
          // Backup media always goes in a new namespace: distinct byte variants can
          // never overwrite device media (including nested same-basename files).
          const files = new Directory(stagingRoot, FILES_DIR_NAME);
          if (files.exists) copyDirContents(files, mediaRoot);
          await retargetRestoreMediaOwned(fresh!, mediaRoot, namespace);
          rollback.create({ intermediates: true, idempotent: false });
          await copyDatabaseFileOwned(current, rollback);
          const currentFiles = new Directory(Paths.document, FILES_DIR_NAME);
          if (currentFiles.exists) copyDirContents(currentFiles, new Directory(rollback, FILES_DIR_NAME));
          await retainDeviceResourcesOwned(current, fresh!);
          // serialize captures WAL state; install only a fully closed staged file.
          await copyDatabaseFileOwned(fresh!, preparedRoot);
          const closing = fresh!;
          fresh = undefined;
          await closeTemporaryDatabase(closing);
        },
      ));
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}${rollback.exists ? ` Private pre-restore rollback retained at ${rollback.uri}.` : ""}`);
    } finally {
      // Both closes must be attempted, including failed extension finalization.
      const handles = [source, fresh].filter((handle): handle is SQLiteDatabase => !!handle);
      const results = await Promise.allSettled(handles.map(closeTemporaryDatabase));
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    }
  } finally {
    try {
      stagingRoot.delete();
    } catch {
      // non-critical
    }
  }
}

/**
 * Picks a backup file via the system file picker. Returns a local file URI
 * (SAF content URIs are copied into cache so the zip lib can read them).
 */
export async function pickBackupFile(): Promise<string> {
  const picked = await File.pickFileAsync(undefined, ZIP_MIME);
  const src = Array.isArray(picked) ? picked[0] : picked;
  if (!src) throw new Error("No backup file selected.");

  // content:// URIs aren't directly readable by the zip native module; copy to cache.
  if (!src.uri.startsWith("file://")) {
    const dest = new File(Paths.cache, `picked-backup-${makeStagingId()}.zip`);
    // SAF/content URIs may point to large media-heavy backups. The sync bytesSync()
    // path buffers the entire archive in JS and can OOM on Android; native copyAsync
    // streams the provider content directly to the cache file.
    await copyAsync({ from: src.uri, to: dest.uri });
    return dest.uri;
  }
  return src.uri;
}

async function copyDatabaseFileOwned(db: SQLiteDatabase, destDir: Directory): Promise<void> {
  const data = await db.serializeAsync();
  const dbFile = new File(destDir, DB_FILENAME);
  dbFile.create({ overwrite: true, intermediates: true });
  dbFile.write(data);
}

async function buildManifestOwned(db: SQLiteDatabase): Promise<BackupManifest> {
  const folders = await db.getAllAsync<Folder>("SELECT id FROM folders");
  const items = await db.getAllAsync<StashItem>("SELECT id FROM items");
  return {
    format: BACKUP_FORMAT,
    createdAt: Date.now(),
    app: "stash",
    folderCount: folders.length,
    itemCount: items.length,
  };
}

function safeSegment(name: string): string {
  if (!name || name === "." || name === ".." || /[\\/\0]/.test(name)) throw new Error("Unsafe backup media path.");
  return name;
}

function relativeStashPath(uri: string): string | null {
  if (!uri.startsWith("file://")) return null;
  const offset = uri.indexOf(`/${FILES_DIR_NAME}/`);
  if (offset < 0) return null;
  const path = uri.slice(offset + FILES_DIR_NAME.length + 2);
  return path.split("/").map((part) => safeSegment(decodeURIComponent(part))).join("/");
}

async function retargetRestoreMediaOwned(db: SQLiteDatabase, media: Directory, namespace: string): Promise<void> {
  const rows = await db.getAllAsync<{ id: string; type: string; uri: string; thumbnail_path: string | null }>("SELECT id, type, uri, thumbnail_path FROM items");
  const retarget = (value: string | null): string | null => {
    if (!value) return null;
    const relative = relativeStashPath(value);
    if (!relative || !new File(media, relative).exists) return null;
    return new File(Paths.document, FILES_DIR_NAME, namespace, relative).uri;
  };
  for (const row of rows) {
    const uri = row.type === "image" || row.type === "file" ? retarget(row.uri) : row.uri;
    if (!uri) throw new Error(`Backup media is unavailable for item ${row.id}; no data was replaced.`);
    await db.runAsync("UPDATE items SET uri = ?, thumbnail_path = ? WHERE id = ?", uri, retarget(row.thumbnail_path), row.id);
  }
  const resources = await db.getFirstAsync<{ present: number }>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'stash_restore_media') AS present");
  if (resources?.present) {
    const mappings = await db.getAllAsync<{ id: string; uri: string; thumbnail_path: string | null }>("SELECT id, uri, thumbnail_path FROM stash_restore_media");
    for (const row of mappings) {
      const uri = retarget(row.uri);
      if (uri) await db.runAsync("UPDATE stash_restore_media SET uri = ?, thumbnail_path = ? WHERE id = ?", uri, retarget(row.thumbnail_path), row.id);
      else await db.runAsync("DELETE FROM stash_restore_media WHERE id = ?", row.id);
    }
  }
}

/** Local resources only, not another account's app/CRR history. Bytes remain in
 * place and also in rollback. They can make a server-only media row readable. */
async function retainDeviceResourcesOwned(current: SQLiteDatabase, fresh: SQLiteDatabase): Promise<void> {
  await fresh.execAsync(RESTORE_MEDIA_SCHEMA);
  const rows = await current.getAllAsync<{ id: string; uri: string; thumbnail_path: string | null }>("SELECT id, uri, thumbnail_path FROM items WHERE type IN ('image', 'file')");
  const resources = await current.getFirstAsync<{ present: number }>("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = 'stash_restore_media') AS present");
  if (resources?.present) rows.push(...await current.getAllAsync<{ id: string; uri: string; thumbnail_path: string | null }>("SELECT id, uri, thumbnail_path FROM stash_restore_media"));
  for (const row of rows) {
    if (!row.uri.startsWith("file://") || !new File(row.uri).exists) continue;
    const thumbnail = row.thumbnail_path?.startsWith("file://") && new File(row.thumbnail_path).exists ? row.thumbnail_path : null;
    await fresh.runAsync("INSERT OR IGNORE INTO stash_restore_media VALUES (?, ?, ?)", row.id, row.uri, thumbnail);
  }
  const folders = await current.getAllAsync<{ id: string; last_used_at: number }>("SELECT id, last_used_at FROM folders");
  for (const folder of folders) await fresh.runAsync("UPDATE folders SET last_used_at = ? WHERE id = ?", folder.last_used_at, folder.id);
}

function copyFileContents(src: File, dest: File): void {
  if (dest.exists) throw new Error("Refusing to overwrite existing restored bytes.");
  src.copy(dest);
}

function copyDirContents(src: Directory, dest: Directory): void {
  dest.create({ intermediates: true, idempotent: true });
  for (const entry of src.list()) {
    if (entry instanceof Directory) {
      copyDirContents(entry, new Directory(dest, safeSegment(entry.name)));
    } else if (entry instanceof File) {
      copyFileContents(entry, new File(dest, safeSegment(entry.name)));
    }
  }
}

async function replaceDatabase(stagingRoot: Directory): Promise<void> {
  const restoredDb = new File(stagingRoot, DB_FILENAME);
  if (!restoredDb.exists) {
    throw new Error("Backup is missing the database file.");
  }

  // The DB lives in <document>/SQLite on both platforms.
  const sqliteDir = new Directory(Paths.document, "SQLite");
  sqliteDir.create({ intermediates: true, idempotent: true });
  const target = new File(sqliteDir, DB_FILENAME);

  // Remove any existing db + WAL/SHM sidecars so we start clean.
  for (const name of [DB_FILENAME, `${DB_FILENAME}-wal`, `${DB_FILENAME}-shm`]) {
    const f = new File(sqliteDir, name);
    if (f.exists) {
      f.delete();
    }
  }

  copyFileContents(restoredDb, target);
}
