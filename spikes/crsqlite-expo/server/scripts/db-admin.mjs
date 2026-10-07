import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, readFile, rename, rm, stat } from "node:fs/promises";
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
    db.close();
  }
}

if (command === "backup") {
  if (!argument) throw new Error("usage: db-admin.mjs backup <destination.sqlite>");
  const destination = path.resolve(argument);
  if (destination === databasePath || destination.startsWith(`${dataDir}${path.sep}`)) {
    throw new Error("backup destination must be outside DATA_DIR");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const source = new Database(databasePath, { readonly: true, fileMustExist: true });
  try {
    await source.backup(destination);
  } finally {
    source.close();
  }
  try {
    const metadata = openAndValidate(destination);
    console.log(JSON.stringify({ ok: true, command, destination, ...metadata }));
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
} else if (command === "restore") {
  if (!argument) throw new Error("usage: db-admin.mjs restore <backup.sqlite>");
  const source = path.resolve(argument);
  if (source === databasePath) throw new Error("restore source must not be the live database");
  const metadata = openAndValidate(source);
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const currentStat = await stat(databasePath).catch(() => null);
  const rollback = `${databasePath}.pre-restore-${new Date().toISOString().replaceAll(":", "-")}.bak`;
  if (currentStat) {
    const live = new Database(databasePath, { readonly: true });
    try { await live.backup(rollback); }
    finally { live.close(); }
  }
  const replacement = `${databasePath}.restore-${process.pid}`;
  await copyFile(source, replacement);
  await chmod(replacement, 0o600);
  openAndValidate(replacement);
  await rename(replacement, databasePath);
  await Promise.all([
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true }),
  ]);
  console.log(JSON.stringify({ ok: true, command, source, rollback: currentStat ? rollback : null, ...metadata }));
} else {
  throw new Error("usage: db-admin.mjs <backup|restore> <path>");
}
