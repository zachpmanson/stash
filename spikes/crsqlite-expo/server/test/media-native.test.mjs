import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import WebSocket from "ws";
import { encode, decode, tags } from "@vlcn.io/ws-common";
import { launch, waitFor } from "./web-helpers.mjs";
const { createNativeHarness } = createRequire(import.meta.url)("../../../../scripts/restore-test-harness.cjs");

test("disposable real CR-SQLite peers: Android originals backfill into web thumbnails, browser-created images verify/download/project on another Android replica", { timeout: 45000 }, async t => {
  const { base, port, json } = await launch(t);
  const authorization = "Basic c3ludGhldGljOnRlc3Q=";
  async function peer() {
    const h = await createNativeHarness(); t.after(() => h.cleanup());
    // Same-host Caddy stamping is controlled here; source queue still supplies
    // and scopes its native Basic header. Actual proxy rejection is browser-tested.
    const request = async (url, options = {}) => {
      assert.equal(options.headers.Authorization, authorization);
      return fetch(url, { ...options, headers: { ...options.headers, "X-Auth-User": "web-test-owner" },
        ...(options.body instanceof h.File ? { body: options.body.bytesSync() } : {}) });
    };
    h.options.fetch = request; h.options.nativeFetch = request;
    const app = h.load("src/db/database.ts"); const replica = h.load("src/db/syncReplica.ts");
    await app.withAppDb(async db => { await app.ensureCrsqliteLoaded(db); await replica.seedSyncReplicaOwned(db, false); });
    const site = await app.withAppDb(async db => (await db.getFirstAsync("SELECT crsql_site_id() AS id")).id);
    const Adapter = h.load("src/db/syncClient.ts").StashReplica; const adapter = new Adapter("app", site);
    t.after(async () => { adapter.close(false); await adapter.waitForPendingChanges(); });
    const health = await (await fetch(base + "/healthz")).json();
    const protocol = Buffer.from("room=stash-backend").toString("base64").replace(/=+$/, "");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sync`, protocol, { headers: { "X-Auth-User": "web-test-owner" } });
    t.after(() => ws.terminate());
    let incoming = Promise.resolve(), remote, failure, sent = 0n;
    ws.on("message", data => {
      const message = decode(new Uint8Array(data));
      if (message._tag === tags.StartStreaming) remote = message.excludeSites[0];
      if (message._tag === tags.Changes) incoming = incoming.then(() => adapter.applyChangesetAndSetLastSeen(message.changes, message.sender, [message.changes.at(-1)[5], 0])).catch(error => { failure = error; });
    });
    await once(ws, "open");
    ws.send(encode({ _tag: tags.AnnouncePresence, sender: site, lastSeens: [], schemaName: health.schema, schemaVersion: BigInt(health.schemaVersion) }));
    await waitFor(() => !!remote);
    async function uploadMetadata() {
      const changes = await adapter.pullChangeset([sent, 0], [remote], false);
      if (!changes.length) return;
      ws.send(encode({ _tag: tags.Changes, sender: site, since: [sent, 0], changes }));
      sent = changes.reduce((v, c) => c[5] > v ? c[5] : v, 0n);
      await waitFor(async () => BigInt((await (await request(`${base}/sync/status?clientSiteId=${Buffer.from(site).toString("hex")}`, { headers: { Authorization: authorization } })).json()).clientSeenVersion) >= sent);
    }
    async function receive(id) {
      await waitFor(async () => { await incoming; if (failure) throw failure; return app.withAppDb(db => db.getFirstAsync("SELECT id FROM sync_items WHERE id=?", id)); });
    }
    async function project() { await app.withAppDb(async db => { await replica.markSyncSnapshotCompleteOwned(db); await replica.projectSyncReplicaToLocalOwned(db); }); }
    return { h, app, replica, uploadMetadata, receive, project, queue: h.load("src/db/mediaQueue.ts") };
  }
  const phone = await peer(); const other = await peer();
  const bytes = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#123abc" } }).png().toBuffer();
  const directory = new phone.h.Directory(phone.h.Paths.document, "stash"); directory.create();
  const file = new phone.h.File(directory, "synthetic-phone.png"); file.create(); file.write(bytes);
  await phone.h.load("src/db/items.ts").saveItem({ id: "phone-photo", type: "image", uri: file.uri, created_at: 1, folder_ids: [] }, []);
  await phone.uploadMetadata();
  assert.equal((await json("/items/phone-photo")).image.state, "pending");
  let transfer = await phone.queue.runStashMediaCycle(new URL(base), "synthetic", authorization, new AbortController().signal);
  assert.equal(transfer.status.pending, 0);
  const web = await json("/items/phone-photo"); assert.equal(web.image.state, "available");
  const thumb = await fetch(base + web.image.thumbnailUrl, { headers: { "X-Auth-User": "web-test-owner" } });
  assert.equal((await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()).format, "jpeg");
  await other.receive("phone-photo"); await other.project();
  assert.equal(await other.h.load("src/db/items.ts").getItemById("phone-photo"), null, "metadata alone is not byte completion");
  transfer = await other.queue.runStashMediaCycle(new URL(base), "synthetic", authorization, new AbortController().signal);
  assert.equal(transfer.projected, true); await other.project();
  assert.deepEqual(await readFile(other.h.localPath((await other.h.load("src/db/items.ts").getItemById("phone-photo")).uri)), bytes);
  const browserId = crypto.randomUUID(); const browserBytes = await sharp({ create: { width: 90, height: 70, channels: 3, background: "orange" } }).webp().toBuffer();
  assert.equal((await fetch(`${base}/api/media/uploads/${browserId}`, { method: "PUT", headers: { "X-Auth-User": "web-test-owner", "X-Stash-Request": "1", "Content-Type": "application/octet-stream", "X-Stash-Content-SHA256": createHash("sha256").update(browserBytes).digest("hex") }, body: browserBytes })).status, 200);
  await json(`/media/uploads/${browserId}/finalize`, "POST", { title: "Browser synthetic image" });
  await phone.receive(browserId); await phone.project();
  transfer = await phone.queue.runStashMediaCycle(new URL(base), "synthetic", authorization, new AbortController().signal);
  assert.equal(transfer.projected, true); await phone.project();
  const projected = await phone.h.load("src/db/items.ts").getItemById(browserId);
  assert.equal(projected.id, browserId); assert.deepEqual(await readFile(phone.h.localPath(projected.uri)), browserBytes);
  assert.equal(await phone.app.withAppDb(async db => (await db.getFirstAsync("SELECT media_id FROM sync_items WHERE id=?", browserId)).media_id), browserId);
});
