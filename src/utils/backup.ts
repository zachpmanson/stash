import * as Sharing from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { zip, unzip } from "react-native-zip-archive";
import { checkpointDb, closeDb, getDb } from "../db/database";
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
  // Flush any WAL data into the main .db file so the copy is complete.
  await checkpointDb();

  const stagingId = makeStagingId();
  const stagingRoot = new Directory(Paths.cache, `stash-backup-${stagingId}`);
  stagingRoot.create({ intermediates: true, idempotent: true });

  // 1. Copy the database into staging.
  await copyDatabaseFile(new Directory(stagingRoot));

  // 2. Copy the stashed media/files directory into staging.
  const srcFiles = new Directory(Paths.document, FILES_DIR_NAME);
  if (srcFiles.exists) {
    copyDirContents(srcFiles, new Directory(stagingRoot, FILES_DIR_NAME));
  }

  // 3. Write a manifest with counts.
  const manifest = await buildManifest();
  const manifestFile = new File(stagingRoot, MANIFEST_NAME);
  manifestFile.create({ overwrite: true, intermediates: true });
  manifestFile.write(JSON.stringify(manifest, null, 2));

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

    // 3. Close the DB, then swap in the restored database + files.
    await closeDb();

    await replaceDatabase(new Directory(stagingRoot));
    await replaceFilesDir(new Directory(stagingRoot, FILES_DIR_NAME));

    return manifest;
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
    copyFileContents(src, dest);
    return dest.uri;
  }
  return src.uri;
}

async function copyDatabaseFile(destDir: Directory): Promise<void> {
  const db = await getDb();
  const data = await db.serializeAsync();
  const dbFile = new File(destDir, DB_FILENAME);
  dbFile.create({ overwrite: true, intermediates: true });
  dbFile.write(data);
}

async function buildManifest(): Promise<BackupManifest> {
  const db = await getDb();
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
