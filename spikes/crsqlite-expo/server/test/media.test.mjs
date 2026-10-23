import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, stat, mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { once } from "node:events";
import path from "node:path";
import sharp from "sharp";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { launch, waitFor } from "./web-helpers.mjs";
import { syntheticPng } from "./png-fixtures.mjs";
import { receiveImage, manifest, commitManifest, blobPath, MEDIA_MAX_BYTES } from "../src/media-store.ts";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const image = color => sharp({ create: { width: 40, height: 30, channels: 3, background: color } }).png().toBuffer();
const headers = bytes => ({ "X-Auth-User": "web-test-owner", "X-Stash-Request": "1",
  "Content-Type": "application/octet-stream", "X-Stash-Content-SHA256": digest(bytes) });
const upload = (base, route, bytes, extra = {}) => fetch(base + "/api/media" + route, { method: "PUT", headers: { ...headers(bytes), ...extra }, body: bytes });
function mutate(tmp, fn) {
  const db = new Database(path.join(tmp, "stash-backend"));
  db.loadExtension(extensionPath);
  try { return fn(db); } finally { db.prepare("SELECT crsql_finalize()").get(); db.close(); }
}

test("private CAS stages bytes before atomic idempotent image+folder creation; deduplicates originals and serves bounded private derivatives", async t => {
  const { base, json, tmp } = await launch(t);
  const bytes = await image("#ab1234"); const first = randomUUID(); const second = randomUUID();
  const { id: folderId } = await json("/folders", "POST", { name: "Synthetic images" });
  for (const id of [first, second]) {
    for (let retry = 0; retry < 2; retry++) {
      const response = await upload(base, `/uploads/${id}`, bytes);
      assert.equal(response.status, 200, await response.text());
    }
    assert.equal((await json("/items")).items.length, id === first ? 0 : 1, "no item before finalization");
    for (let retry = 0; retry < 2; retry++) assert.deepEqual(await json(`/media/uploads/${id}/finalize`, "POST", { title: "Synthetic", folderId }), { id });
    assert.equal((await json(`/items/${id}`)).id, id);
    const status = await json(`/media/items/${id}/status`);
    assert.equal(status.state, "available"); assert.equal(status.sha256, digest(bytes));
    for (const kind of ["original", "preview", "thumbnail"]) {
      const res = await fetch(`${base}/api/media/items/${id}/${kind}`, { headers: headers(bytes) });
      assert.equal(res.status, 200); assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal(res.headers.get("x-content-type-options"), "nosniff");
      const body = Buffer.from(await res.arrayBuffer());
      assert.equal(digest(body), res.headers.get("x-stash-content-sha256"));
      if (kind === "original") assert.deepEqual(body, bytes);
      else { const meta = await sharp(body).metadata(); assert.equal(meta.format, "jpeg"); assert.ok(meta.width <= (kind === "preview" ? 1600 : 384)); }
    }
  }
  assert.equal((await json("/items")).items.length, 2);
  const a = mutate(tmp, db => manifest(db, first)); const b = mutate(tmp, db => manifest(db, second));
  assert.equal(a.original_sha, b.original_sha);
  assert.deepEqual(await readFile(blobPath(path.join(tmp, "media"), a.original_sha)), bytes);
  assert.equal((await stat(blobPath(path.join(tmp, "media"), a.original_sha))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(path.join(tmp, "media", "temporary")), []);
});

test("binary routes retain auth/CSRF bounds and reject invalid, unsupported, oversized and conflicting images", async t => {
  const { base, api, json, tmp } = await launch(t);
  const bytes = await image("#1234ab"); const id = randomUUID();
  for (const identity of ["", "attacker", "zach"]) {
    assert.equal((await upload(base, `/uploads/${id}`, bytes, { "X-Auth-User": identity })).status, 401);
    assert.equal((await fetch(`${base}/api/media/items/missing/original`, { headers: { "X-Auth-User": identity } })).status, 401);
  }
  for (const extra of [{ "X-Stash-Request": "" }, { Origin: "https://attacker.invalid" }, { Origin: "null" },
    { Origin: base.replace("http:", "https:") }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }])
    assert.equal((await upload(base, `/uploads/${id}`, bytes, extra)).status, 403);
  assert.equal((await upload(base, `/uploads/${id}`, bytes, { "Content-Type": "image/png" })).status, 415);
  assert.equal((await upload(base, `/uploads/${id}`, bytes, { "X-Stash-Content-SHA256": "0".repeat(64) })).status, 422);
  for (const invalid of [Buffer.from("<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10'/>"), Buffer.from("<html>Not an image</html>"), bytes.subarray(0, 40), Buffer.alloc(0)])
    assert.ok([415, 422].includes((await upload(base, `/uploads/${id}`, invalid)).status));
  const huge = await sharp({ create: { width: 12001, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await upload(base, `/uploads/${id}`, huge)).status, 415);
  const tooManyPixels = await sharp({ create: { width: 5000, height: 5000, channels: 3, background: "white" } }).png().toBuffer();
  assert.equal((await upload(base, `/uploads/${id}`, tooManyPixels)).status, 415);
  assert.equal((await upload(base, `/uploads/${id}`, Buffer.alloc(MEDIA_MAX_BYTES + 1))).status, 413);
  assert.equal((await api("/items", "POST", { type: "text", content: "x".repeat(70000) })).status, 413);
  assert.equal((await upload(base, `/uploads/${id}`, bytes)).status, 200);
  assert.equal((await upload(base, `/uploads/${id}`, await image("red"))).status, 409);
  await json(`/media/uploads/${id}/finalize`, "POST", {});
  assert.equal((await api(`/media/uploads/${id}/finalize`, "POST", { title: "changed" })).status, 409);
  mutate(tmp, db => db.prepare("DELETE FROM sync_items WHERE id=?").run(id));
  assert.equal((await api(`/media/uploads/${id}/finalize`, "POST", {})).status, 410);
  assert.equal((await upload(base, `/uploads/${id}`, bytes)).status, 410);
  assert.equal((await api(`/media/items/${id}/original`)).status, 404);
  assert.equal((await json("/items")).items.length, 0, "retry cannot resurrect deletion");
  for (const route of ["/items/%2e%2e%2fsecret/original", "/items/%2fetc%2fpasswd/original", "/uploads/%2e%2e%2fsecret"])
    assert.ok([400, 404].includes((await upload(base, route, bytes)).status));
});

test("APNG animation hidden by decoder metadata and excessive PNG chunks fail without a manifest or item", async t => {
  const { base, json, tmp } = await launch(t);
  for (const options of [{ animation: true }, { excessiveChunks: true }]) {
    const bytes = await syntheticPng(options); const id = randomUUID();
    if (options.animation) assert.equal((await sharp(bytes).metadata()).format, 'png');
    assert.equal((await upload(base, `/uploads/${id}`, bytes)).status, 415);
    assert.equal(mutate(tmp, db => manifest(db, id)), undefined);
  }
  assert.equal((await json('/items')).items.length, 0);
  assert.deepEqual(await readdir(path.join(tmp, 'media', 'temporary')), []);
  // Simulate a pre-guard manifest without uploading/inspecting any real data.
  // A retained original cannot bypass policy via a previously accepted mapping.
  const original = await syntheticPng({ animation: true });
  const preview = await sharp({ create: { width: 1, height: 1, channels: 3, background: 'red' } }).jpeg().toBuffer();
  for (const bytes of [original, preview]) {
    const file = blobPath(path.join(tmp, 'media'), digest(bytes));
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 }); await writeFile(file, bytes, { mode: 0o600 });
  }
  mutate(tmp, db => {
    db.prepare("INSERT INTO sync_items(id,type,media_id) VALUES ('retained-animation','image','retained-animation')").run();
    commitManifest(db, { media_id: 'retained-animation', original_sha: digest(original), preview_sha: digest(preview), thumbnail_sha: digest(preview), size: original.length, mime: 'image/png', width: 1, height: 1 });
  });
  const denied = await fetch(base + '/api/media/items/retained-animation/original', { headers: headers(original) });
  assert.equal(denied.status, 415);
  assert.match((await denied.json()).error, /retained bytes were not changed/);
  assert.deepEqual(await readFile(blobPath(path.join(tmp, 'media'), digest(original))), original);
  assert.equal((await fetch(base + '/api/media/items/retained-animation/preview', { headers: headers(original) })).status, 200);
});

test("native metadata-first ordering, interrupted uploads, delete-during-transfer and old-client writes never change identity or resurrect items", async t => {
  const { base, json, tmp } = await launch(t);
  const id = "synthetic-native-image"; const bytes = await image("yellow");
  assert.equal((await upload(base, `/items/${id}/original`, bytes)).status, 404);
  mutate(tmp, db => db.prepare("INSERT INTO sync_items(id,type,media_id) VALUES (?,'image',?)").run(id, id));
  assert.equal((await json(`/media/items/${id}/status`)).state, "pending");
  assert.equal((await upload(base, `/items/${id}/original`, bytes)).status, 200);
  mutate(tmp, db => db.prepare("UPDATE sync_items SET title='ordinary old-client edit',media_id=id WHERE id=?").run(id));
  assert.equal((await json(`/media/items/${id}/status`)).state, "available");
  assert.equal((await upload(base, `/items/${id}/original`, bytes)).status, 200);
  const diskBytes = await image("#ff12ab");
  mutate(tmp, db => {
    db.prepare("INSERT INTO sync_items(id,type,media_id) VALUES ('disk-image','image','disk-image')").run();
    db.exec("CREATE TRIGGER synthetic_disk_failure BEFORE INSERT ON stash_media_v1 WHEN NEW.media_id='disk-image' BEGIN SELECT RAISE(ABORT,'synthetic disk error'); END");
  });
  assert.equal((await upload(base, '/items/disk-image/original', diskBytes)).status, 503);
  assert.equal((await json('/media/items/disk-image/status')).state, 'pending');
  assert.deepEqual(await readFile(blobPath(path.join(tmp, 'media'), digest(diskBytes))), diskBytes, 'DB failure retains complete orphan bytes, not a completed manifest');
  mutate(tmp, db => db.exec('DROP TRIGGER synthetic_disk_failure'));
  assert.equal((await upload(base, '/items/disk-image/original', diskBytes)).status, 200);
  mutate(tmp, db => db.prepare("DELETE FROM sync_items WHERE id='disk-image'").run());
  const root = path.join(tmp, "isolated-media");
  await assert.rejects(receiveImage(root, new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 30)); c.error(new Error("interrupted")); } }), digest(bytes)), /interrupted/);
  assert.deepEqual(await readdir(path.join(root, "temporary")), []);
  // Pause body mid-transfer, delete synthetic metadata, then release remaining
  // bytes. Validation after durable publication must still reject the commit.
  let resume; const ready = new Promise(resolve => { resume = resolve; });
  const body = new ReadableStream({ async start(c) { c.enqueue(bytes.subarray(0, 30)); await ready; c.enqueue(bytes.subarray(30)); c.close(); } });
  const request = fetch(`${base}/api/media/items/${id}/original`, { method: "PUT", headers: headers(bytes), body, duplex: "half" });
  await waitFor(async () => (await readdir(path.join(tmp, "media", "temporary"))).length > 0);
  mutate(tmp, db => db.prepare("DELETE FROM sync_items WHERE id=?").run(id)); resume();
  assert.equal((await request).status, 404);
  assert.equal((await json("/items")).items.length, 0);
});

test("disposable stopped-state DB+blob backup/restore preserves bytes, associations, clocks, identity and denies incomplete recovery", async t => {
  const { base, json, tmp, child } = await launch(t);
  const bytes = await image("purple"); const id = randomUUID();
  assert.equal((await upload(base, `/uploads/${id}`, bytes)).status, 200);
  await json(`/media/uploads/${id}/finalize`, "POST", { title: "Retained synthetic image" });
  const before = mutate(tmp, db => ({
    site: db.prepare("SELECT hex(crsql_site_id())").pluck().get(),
    version: db.prepare("SELECT crsql_db_version()").pluck().get(),
    media: manifest(db, id),
  }));
  const exit = once(child, "exit"); child.kill("SIGTERM"); assert.equal((await exit)[0], 0);
  const directory = await mkdtemp(path.join(os.tmpdir(), "stash-image-recovery-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const snapshot = path.join(directory, "private.sqlite");
  const restored = path.join(directory, "restored");
  async function admin(data, ...args) {
    const result = await promisify(execFile)(process.execPath, ["scripts/db-admin.mjs", ...args], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, DATA_DIR: data, SCHEMA_DIR: path.join(tmp, "schemas") },
    });
    return JSON.parse(result.stdout);
  }
  assert.equal((await admin(tmp, "backup", snapshot)).media, 1);
  await assert.rejects(admin(tmp, "backup", snapshot), /already exists/);
  assert.equal((await stat(snapshot)).mode & 0o777, 0o600);
  assert.equal((await stat(`${snapshot}.media`)).mode & 0o777, 0o700);
  const original = blobPath(`${snapshot}.media`, before.media.original_sha);
  await writeFile(original, "synthetic corruption");
  await assert.rejects(admin(restored, "restore", snapshot), /integrity/);
  await assert.rejects(stat(path.join(restored, "stash-backend")), { code: "ENOENT" });
  await writeFile(original, bytes);
  assert.equal((await admin(restored, "restore", snapshot)).media, 1);
  const after = mutate(restored, db => ({
    site: db.prepare("SELECT hex(crsql_site_id())").pluck().get(),
    version: db.prepare("SELECT crsql_db_version()").pluck().get(),
    media: manifest(db, id),
  }));
  assert.deepEqual(after, before);
  const restarted = await launch(t, { DATA_DIR: restored, SCHEMA_DIR: path.join(tmp, "schemas") });
  assert.equal((await restarted.json(`/items/${id}`)).title, "Retained synthetic image");
  assert.deepEqual(Buffer.from(await (await fetch(`${restarted.base}/api/media/items/${id}/original`, { headers: headers(bytes) })).arrayBuffer()), bytes);
  const secondId = randomUUID(); const secondBytes = await image("orange");
  assert.equal((await upload(restarted.base, `/uploads/${secondId}`, secondBytes)).status, 200);
  await restarted.json(`/media/uploads/${secondId}/finalize`, "POST", { title: "Rollback-only image" });
  await restarted.json(`/items/${id}`, "PATCH", { title: "Changed after snapshot" });
  const stop = once(restarted.child, "exit"); restarted.child.kill("SIGTERM"); await stop;
  await writeFile(blobPath(path.join(restored, "media"), before.media.original_sha), "damaged original");
  await writeFile(blobPath(path.join(restored, "media"), before.media.preview_sha), "damaged derivative");
  const repaired = await admin(restored, "restore", snapshot);
  assert.equal((await readdir(path.join(restored, "media", "retained-corrupt"))).length, 2);
  assert.equal((await stat(`${repaired.rollback}.media`)).mode & 0o777, 0o700);
  await admin(restored, "restore", repaired.rollback);
  const rolledBack = await launch(t, { DATA_DIR: restored, SCHEMA_DIR: path.join(tmp, "schemas") });
  assert.equal((await rolledBack.json(`/items/${id}`)).title, "Changed after snapshot");
  assert.equal((await rolledBack.json(`/items/${secondId}`)).title, "Rollback-only image");
  assert.deepEqual(Buffer.from(await (await fetch(`${rolledBack.base}/api/media/items/${secondId}/original`, { headers: headers(secondBytes) })).arrayBuffer()), secondBytes);
});
