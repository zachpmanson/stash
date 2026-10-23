import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat, open } from "node:fs/promises";
import { copyMediaSnapshot, verifyMediaSnapshot, syncDirectory } from "./media-backup.mjs";
import path from "node:path";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { cryb64 } from "@vlcn.io/ws-common";

const [command, argument] = process.argv.slice(2);
const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const databasePath = path.join(dataDir, "stash-backend");
const schemaDir = path.resolve(process.env.SCHEMA_DIR ?? "./schemas");
const schemaName = "stash-sync-v1.sql";
const expectedVersion = String(cryb64(await readFile(path.join(schemaDir, schemaName), "utf8")));

function openAndValidate(filename) {
  const db = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    db.loadExtension(extensionPath);
    const integrity = db.pragma("integrity_check", { simple: true });
    assert.equal(integrity, "ok", `SQLite integrity check: ${integrity}`);
    const schema = db.prepare("SELECT value FROM crsql_master WHERE key = 'schema_name'").pluck().get();
    assert.equal(schema, schemaName, `unexpected CR-SQLite schema: ${schema}`);
    const version = db.prepare("SELECT value FROM crsql_master WHERE key = 'schema_version'").safeIntegers(true).pluck().get();
    assert.equal(String(version), expectedVersion, `CR-SQLite schema version mismatch: ${version}`);
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
      'sync_folders__crsql_clock', 'sync_items__crsql_clock',
      'sync_item_folders__crsql_clock', 'sync_text_substitutions__crsql_clock',
      'sync_user_settings__crsql_clock'
    )`).all();
    assert.equal(tables.length, 5, "missing one or more Stash CRR tables");
    return { schema, version: String(version) };
  } finally {
    // CRSQLite retains internal prepared statements until explicitly finalized;
    // close alone can leave a read lock that blocks replacement policy writes.
    try { db.prepare("SELECT crsql_finalize()").get(); } finally { db.close(); }
  }
}

if (command === "backup") {
  if (!argument) throw new Error("usage: db-admin.mjs backup <destination.sqlite>");
  const destination = path.resolve(argument);
  if (destination === databasePath || destination.startsWith(`${dataDir}${path.sep}`)) {
    throw new Error("backup destination must be outside DATA_DIR");
  }
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  for (const target of [destination, `${destination}.media`]) {
    if (await stat(target).catch(error => { if (error.code === "ENOENT") return null; throw error; }))
      throw new Error("backup destination already exists; retain it and select a new path");
  }
  const temporary = `${destination}.partial-${process.pid}`;
  const temporaryMedia = `${temporary}.media`;
  let publishedMedia = false;
  try {
    const source = new Database(databasePath, { readonly: true, fileMustExist: true });
    try { await source.backup(temporary); } finally { source.close(); }
    await chmod(temporary, 0o600);
    const metadata = openAndValidate(temporary);
    const media = await copyMediaSnapshot(temporary, path.join(dataDir, "media"), temporaryMedia);
    const fd = await open(temporary, "r"); try { await fd.sync(); } finally { await fd.close(); }
    // Publish the media first. Only the final DB filename signals a complete
    // snapshot. An interrupted sidecar is retained as explicit partial evidence.
    await rename(temporaryMedia, `${destination}.media`); publishedMedia = true;
    await syncDirectory(path.dirname(destination));
    await rename(temporary, destination); await syncDirectory(path.dirname(destination));
    console.log(JSON.stringify({ ok: true, command, destination, media, ...metadata }));
  } catch (error) {
    await rm(temporary, { force: true });
    if (!publishedMedia) await rm(temporaryMedia, { recursive: true, force: true });
    throw error;
  }
} else if (command === "restore") {
  if (!argument) throw new Error("usage: db-admin.mjs restore <backup.sqlite>");
  const source = path.resolve(argument);
  if (source === databasePath) throw new Error("restore source must not be the live database");
  const metadata = openAndValidate(source);
  // A DB with manifests cannot be recovered from a DB-only checkpoint.
  const media = await verifyMediaSnapshot(source, `${source}.media`);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  // Stopped-state recovery may repair damaged objects from this verified
  // snapshot, retaining bad bytes in private quarantine. Do this before making
  // a rollback so its referenced objects can themselves be verified.
  await copyMediaSnapshot(source, `${source}.media`, path.join(dataDir, "media"), { repairCorrupt: true });
  const currentStat = await stat(databasePath).catch(() => null);
  const rollback = `${databasePath}.pre-restore-${new Date().toISOString().replaceAll(":", "-")}.bak`;
  if (currentStat) {
    const live = new Database(databasePath, { readonly: true });
    const partialRollback = `${rollback}.partial`;
    try { await live.backup(partialRollback); }
    finally { live.close(); }
    await chmod(partialRollback, 0o600);
    openAndValidate(partialRollback);
    await copyMediaSnapshot(partialRollback, path.join(dataDir, "media"), `${rollback}.media`);
    const rollbackFd = await open(partialRollback, "r");
    try { await rollbackFd.sync(); } finally { await rollbackFd.close(); }
    await syncDirectory(dataDir);
    await rename(partialRollback, rollback); await syncDirectory(dataDir);
  }
  // Current, quarantine and rollback objects remain retained; no GC.
  const replacement = `${databasePath}.restore-${process.pid}`;
  await copyFile(source, replacement);
  await chmod(replacement, 0o600);
  openAndValidate(replacement);
  // Active folders automatically have private authenticated feeds after restore.
  // Preserve their identities, hashes and semantic dates exactly.
  const restored = new Database(replacement, { fileMustExist: true });
  try {
    // Keep replacement changes in the file, not an adjacent WAL whose old name
    // would be lost at the atomic rename.
    restored.pragma("journal_mode = DELETE");
    restored.loadExtension(extensionPath);
    restored.prepare("SELECT crsql_finalize()").get();
  } finally { restored.close(); }
  const replacementFd = await open(replacement, "r");
  try { await replacementFd.sync(); } finally { await replacementFd.close(); }
  // Never expose the replacement beside the previous DB's WAL: SQLite could
  // replay newer unrelated pages onto the restored snapshot after a crash.
  // First make the stopped old DB independently durable, so interruption before
  // replacement still leaves the complete old state (and full rollback) usable.
  if (currentStat) {
    const stopped = new Database(databasePath, { fileMustExist: true });
    try {
      const checkpoint = stopped.pragma("wal_checkpoint(TRUNCATE)");
      if (checkpoint.some(row => row.busy !== 0)) throw new Error("Stop all database users before restoring");
      assert.equal(stopped.pragma("journal_mode=DELETE", { simple: true }), "delete");
    } finally { stopped.close(); }
    const oldFd = await open(databasePath, "r");
    try { await oldFd.sync(); } finally { await oldFd.close(); }
  }
  await Promise.all([
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
  await syncDirectory(dataDir);
  await rename(replacement, databasePath);
  await syncDirectory(dataDir);
  console.log(JSON.stringify({ ok: true, command, source, rollback: currentStat ? rollback : null, media, ...metadata }));
} else {
  throw new Error("usage: db-admin.mjs <backup|restore> <path>");
}
