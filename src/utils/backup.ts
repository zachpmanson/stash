import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { copyAsync } from "expo-file-system/legacy";
import { zip, unzip } from "react-native-zip-archive";
import type { SQLiteDatabase } from "expo-sqlite";
import { checkpointDbOwned, withAppDb, withAppDbReplacement } from "../db/database";
import { withStashSyncRestoreLock } from "../db/syncClient";
import { Folder, StashItem } from "../types";

const DB_FILENAME = "stash.db";
// The stashed media/files live in <document>/stash/ (see src/utils/fileUtils.ts).
// We keep the same name both where they're read from and the zip-internal folder.
const FILES_DIR_NAME = "stash";
const MANIFEST_NAME = "manifest.json";
const BACKUP_FORMAT = 1;
const ZIP_MIME = "application/zip";

// Located nowhere near the shared taskset debate: this module does backup/restore on the device.

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
 * Destructive: replaces the current database and stashed media with the
 * contents of the backup.
 */
export async function restoreBackup(fileUri: string): Promise<BackupManifest> {
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
    return await withStashSyncRestoreLock(() => withAppDbReplacement(
      async () => {
        await replaceDatabase(new Directory(stagingRoot));
        await replaceFilesDir(new Directory(stagingRoot, FILES_DIR_NAME));
      },
      async (database) => {
        // Cross-package backups contain absolute paths; retarget after reopening,
        // while still owning the replacement queue (do not acquire it again).
        await rewriteStoredUrisOwned(database);
        return manifest;
      },
    ));
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

/**
 * Re-targets stored media URIs at this app's document stash dir.
 *
 * `copyFileToStash` writes absolute `file:///data/user/0/<pkg>/files/stash/<f>`
 * URIs into the DB. When a backup made in another app instance (e.g. release
 * vs debug) is restored, those paths still point at the old package's private
 * dir. Rewrite every local stash URI using the current document dir, keyed by
 * filename (the restored files are already in place by the time this runs).
 */
async function rewriteStoredUrisOwned(db: SQLiteDatabase): Promise<void> {
  const stashDir = new Directory(Paths.document, FILES_DIR_NAME);
  if (!stashDir.exists) return;

  // Filenames present in the restored stash dir.
  const present = new Set<string>();
  const collect = (dir: Directory) => {
    for (const entry of dir.list()) {
      if (entry instanceof Directory) {
        collect(entry);
      } else {
        present.add(entry.name);
      }
    }
  };
  collect(stashDir);

  const rows = await db.getAllAsync<{ id: string; uri: string; thumbnail_path: string | null }>(
    "SELECT id, uri, thumbnail_path FROM items",
  );

  for (const row of rows) {
    const rewrittenUri = retargetLocalUri(row.uri, stashDir, present);
    const rewrittenThumb = retargetLocalUri(row.thumbnail_path, stashDir, present);
    if (rewrittenUri === row.uri && rewrittenThumb === row.thumbnail_path) {
      continue;
    }
    await db.runAsync("UPDATE items SET uri = ?, thumbnail_path = ? WHERE id = ?", [
      rewrittenUri,
      rewrittenThumb,
      row.id,
    ]);
  }
}

function retargetLocalUri(
  value: string | null,
  stashDir: Directory,
  present: Set<string>,
): string | null {
  if (!value || !value.startsWith("file://") || !value.includes(`/${FILES_DIR_NAME}/`)) {
    return value;
  }
  const filename = value.split("/").pop();
  if (!filename || !present.has(filename)) {
    return value;
  }
  const target = new File(stashDir, filename);
  return target.uri;
}

function copyFileContents(src: File, dest: File): void {
  dest.create({ overwrite: true, intermediates: true });
  const bytes = src.bytesSync();
  dest.write(bytes);
}

function copyDirContents(src: Directory, dest: Directory): void {
  dest.create({ intermediates: true, idempotent: true });
  for (const entry of src.list()) {
    if (entry instanceof Directory) {
      copyDirContents(entry, new Directory(dest, entry.name));
    } else if (entry instanceof File) {
      copyFileContents(entry, new File(dest, entry.name));
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

async function replaceFilesDir(stagingFiles: Directory): Promise<void> {
  const dest = new Directory(Paths.document, FILES_DIR_NAME);
  if (dest.exists) {
    dest.delete();
  }
  if (stagingFiles.exists) {
    copyDirContents(stagingFiles, dest);
  }
}
