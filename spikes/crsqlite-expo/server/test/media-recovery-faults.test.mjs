import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import { stat, readdir } from "node:fs/promises";
import path from "node:path";
import { launch } from "./web-helpers.mjs";
import sharp from "sharp";
import Database from "better-sqlite3";
const root = path.resolve(import.meta.dirname, "..");
const cli = process.env.STASH_TEST_SERVER_ENTRY ? path.resolve(process.env.STASH_TEST_SERVER_ENTRY, "../../../scripts/db-admin.mjs") : path.join(root, "scripts/db-admin.mjs");
const run = promisify(execFile);

for (const boundary of ["before-replace", "after-replace"]) test(`restore crash ${boundary} cannot replay the previous live WAL onto the selected snapshot`, async t => {
  const { base, json, tmp, child } = await launch(t);
  const id = randomUUID(); const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "blue" } }).png().toBuffer();
  assert.equal((await fetch(`${base}/api/media/uploads/${id}`, { method: "PUT", headers: {
    "X-Auth-User": "web-test-owner", "X-Stash-Request": "1", "Content-Type": "application/octet-stream",
    "X-Stash-Content-SHA256": createHash("sha256").update(bytes).digest("hex"),
  }, body: bytes })).status, 200);
  await json(`/media/uploads/${id}/finalize`, "POST", { title: "before snapshot" });
  const stopped = once(child, "exit"); child.kill("SIGTERM"); assert.equal((await stopped)[0], 0);
  const snapshot = path.join(tmp, "..", `${path.basename(tmp)}-snapshot.sqlite`);
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(snapshot, { force: true }); await rm(`${snapshot}.media`, { recursive: true, force: true }); });
  const env = { ...process.env, DATA_DIR: tmp, SCHEMA_DIR: path.join(tmp, "schemas") };
  await run(process.execPath, [cli, "backup", snapshot], { cwd: root, env });
  const database = path.join(tmp, "stash-backend");
  const hot = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import{createRequire}from'node:module';import{pathToFileURL}from'node:url';
    const require=createRequire(${JSON.stringify(path.join(root, "package.json"))});
    const Database=require('better-sqlite3');const {extensionPath}=await import(pathToFileURL(require.resolve('@vlcn.io/crsqlite')));
    const db=new Database(${JSON.stringify(database)});db.loadExtension(extensionPath);db.pragma('journal_mode=WAL');
    db.prepare('UPDATE sync_items SET title=? WHERE id=?').run('newer WAL value',${JSON.stringify(id)});process.kill(process.pid,'SIGKILL');
  `], { cwd: root, env, encoding: "utf8" });
  assert.equal(hot.signal, "SIGKILL", hot.stderr);
  assert.ok((await stat(`${database}-wal`)).size > 32, "real nonempty old WAL is present before restore");
  const injection = `
    import fs from'node:fs';import{syncBuiltinESMExports}from'node:module';import{pathToFileURL}from'node:url';
    const db=${JSON.stringify(database)};
    ${boundary === "before-replace" ? `const old=fs.promises.rm;fs.promises.rm=async(file,...args)=>{if(file===db+'-wal')throw Error('synthetic interruption before replacement');return old(file,...args)};` : `const old=fs.promises.rename;fs.promises.rename=async(from,to)=>{await old(from,to);if(to===db)throw Error('synthetic interruption after replacement')};`}
    syncBuiltinESMExports();process.argv=[process.execPath,${JSON.stringify(cli)},'restore',${JSON.stringify(snapshot)}];await import(pathToFileURL(${JSON.stringify(cli)}));
  `;
  await assert.rejects(run(process.execPath, ["--input-type=module", "-e", injection], { cwd: root, env }), /synthetic interruption/);
  const inspected = new Database(database, { readonly: true });
  try { assert.equal(inspected.prepare("SELECT title FROM sync_items WHERE id=?").pluck().get(id), boundary === "before-replace" ? "newer WAL value" : "before snapshot"); }
  finally { inspected.close(); }
  await assert.rejects(stat(`${database}-wal`), { code: "ENOENT" });
  const rollback = (await readdir(tmp)).find(name => name.endsWith(".bak"));
  assert.ok(rollback); assert.ok((await stat(path.join(tmp, `${rollback}.media`))).isDirectory());
});
