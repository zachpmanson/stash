// Stopped-state DB+CAS recovery helper. No GC: live and rollback manifests share
// immutable retained blobs. Callers must never remove phone or backup originals.
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { copyFile, lstat, mkdir, open, link, unlink, rename } from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";

function filename(root, sha) {
  if (!/^[a-f0-9]{64}$/.test(sha)) throw new Error("Invalid image manifest digest");
  return path.join(root, "sha256", sha.slice(0, 2), sha);
}
async function syncDirectory(directory) {
  const fd = await open(directory, "r"); try { await fd.sync(); } finally { await fd.close(); }
}
async function hashFile(file, sha) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("Image snapshot requires ordinary private files");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (hash.digest("hex") !== sha) throw new Error("Image snapshot integrity check failed");
  return info.size;
}
export function mediaReferences(database) {
  const db = new Database(database, { readonly: true, fileMustExist: true });
  try {
    if (!db.prepare("SELECT name FROM sqlite_master WHERE name='stash_media_v1'").get()) return [];
    return db.prepare("SELECT original_sha,preview_sha,thumbnail_sha,size FROM stash_media_v1").all();
  } finally { db.close(); }
}
export async function verifyMediaSnapshot(database, root) {
  const references = mediaReferences(database);
  for (const row of references) for (const kind of ["original", "preview", "thumbnail"]) {
    const size = await hashFile(filename(root, row[`${kind}_sha`]), row[`${kind}_sha`]);
    if (kind === "original" && size !== row.size) throw new Error("Image snapshot size mismatch");
  }
  return references.length;
}
export async function copyMediaSnapshot(database, sourceRoot, targetRoot, { repairCorrupt = false } = {}) {
  const references = mediaReferences(database);
  await mkdir(targetRoot, { recursive: true, mode: 0o700 });
  for (const row of references) for (const kind of ["original", "preview", "thumbnail"]) {
    const sha = row[`${kind}_sha`]; const source = filename(sourceRoot, sha); const destination = filename(targetRoot, sha);
    await hashFile(source, sha);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    // Existing live objects are checked, never replaced during recovery. New
    // objects are published atomically before the DB is replaced.
    const existing = await lstat(destination).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (existing) {
      try { await hashFile(destination, sha); continue; }
      catch (error) {
        if (!repairCorrupt || !existing.isFile() || existing.isSymbolicLink()) throw error;
        // Explicit stopped-state repair: retain the damaged object as evidence,
        // never delete/overwrite it. A failed repair remains safe to retry from
        // the independently verified snapshot before starting the service.
        const quarantine = path.join(targetRoot, "retained-corrupt");
        await mkdir(quarantine, { recursive: true, mode: 0o700 });
        await syncDirectory(targetRoot);
        await rename(destination, path.join(quarantine, `${sha}.${randomUUID()}`));
        await syncDirectory(quarantine); await syncDirectory(path.dirname(destination));
      }
    }
    const temporary = `${destination}.restore-${process.pid}`;
    try {
      await copyFile(source, temporary);
      await hashFile(temporary, sha);
      const fd = await open(temporary, "r+");
      try { await fd.chmod(0o600); await fd.sync(); } finally { await fd.close(); }
      try { await link(temporary, destination); }
      catch (error) { if (error.code !== "EEXIST") throw error; await hashFile(destination, sha); }
      await syncDirectory(path.dirname(destination));
      await syncDirectory(path.dirname(path.dirname(destination)));
    } finally { await unlink(temporary).catch(() => {}); }
  }
  await syncDirectory(targetRoot); await syncDirectory(path.dirname(targetRoot));
  return verifyMediaSnapshot(database, targetRoot);
}
export { syncDirectory };
