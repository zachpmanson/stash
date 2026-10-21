import assert from "node:assert/strict";
import test from "node:test";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createRequire } from "node:module";
import WebSocket from "ws";
import { encode, decode, tags } from "@vlcn.io/ws-common";
import { launch, waitFor } from "./web-helpers.mjs";

// Immutable app source; Expo boundaries controlled, real Node24 CRSQLite and actual
// StashReplica/mirror/project helpers. NODE_PATH resolves TypeScript in the server devshell.
const { createNativeHarness } = createRequire(import.meta.url)(
  "../../../../scripts/restore-test-harness.cjs",
);

test(
  "API validates auth, types, limits, CSRF, static routes and atomic rollback",
  { timeout: 30000 },
  async (t) => {
    const { base, api, json } = await launch(t);
    for (const url of [
      "/api",
      "/api/items",
      "/api/unknown",
      "/api/items/x/folders/y",
    ]) {
      for (const identity of [undefined, "zach", "attacker"]) {
        const res = await fetch(base + url, {
          headers: identity ? { "X-Auth-User": identity } : {},
        });
        assert.equal(res.status, 401);
      }
    }
    assert.equal(
      (await fetch(base + "/test/items")).status,
      404,
      "test hooks remain off",
    );
    assert.equal((await api("/unknown")).status, 404);
    assert.equal((await api("/items", "DELETE", {})).status, 404);
    for (const data of [
      { type: "file", content: "x" },
      { type: "text", content: 4 },
      { type: "text", content: "" },
      { type: "text", content: "x", article_html: "<script>" },
      { type: "text", content: "x", media_id: "private" },
      { type: "url", content: "javascript:alert(1)" },
      { type: "url", content: "file:///etc/passwd" },
      { type: "url", content: "https://user:secret@example.com" },
      { type: "text", content: "a".repeat(48001) },
    ]) {
      assert.equal(
        (await api("/items", "POST", data)).status,
        400,
        JSON.stringify(data).slice(0, 100),
      );
    }
    assert.equal(
      (
        await api("/items", "POST", {
          type: "text",
          content: "a".repeat(70000),
        })
      ).status,
      413,
    );
    const malformed = await fetch(base + "/api/items", {
      method: "POST",
      headers: {
        "X-Auth-User": "web-test-owner",
        "Content-Type": "application/json",
        "X-Stash-Request": "1",
      },
      body: "{",
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), { error: "Invalid JSON" });
    const csrf = await api(
      "/items",
      "POST",
      { type: "text", content: "CSRF" },
      { Origin: "https://attacker.invalid" },
    );
    assert.equal(csrf.status, 403);
    assert.equal(
      (await api("/items", "POST", {}, { "X-Stash-Request": "" })).status,
      403,
    );
    assert.equal((await api("/items?offset=-1")).status, 400);
    assert.equal(
      (await api("/items?archived=true&archived=false")).status,
      400,
    );
    const chunked = await new Promise((resolve, reject) => {
      const req = httpRequest(
        base + "/api/items",
        {
          method: "POST",
          headers: {
            "X-Auth-User": "web-test-owner",
            "X-Stash-Request": "1",
            "Content-Type": "application/json",
          },
        },
        (res) => {
          res.resume();
          resolve(res);
        },
      );
      req.on("error", reject);
      req.write('{"type":"text","content":"');
      req.write("a".repeat(70000));
      req.end('"}');
    });
    assert.equal(
      chunked.statusCode,
      413,
      "streaming body limit also applies without Content-Length",
    );
    const { id } = await json("/items", "POST", {
      type: "text",
      title: "Original",
      content: "<img src=x onerror=alert(1)> '); DROP TABLE sync_items; --",
    });
    assert.equal(
      (
        await api(`/items/${id}`, "PATCH", {
          content: "should roll back",
          archived: "bad",
        })
      ).status,
      400,
    );
    assert.match((await json(`/items/${id}`)).content, /DROP TABLE/);
    assert.equal((await json(`/items/${id}`)).title, "Original");
    const { id: folderId } = await json("/folders", "POST", {
      name: "SQL '); DROP TABLE sync_items; --",
    });
    assert.equal(
      (
        await api(`/folders/${folderId}`, "PATCH", {
          name: "rollback",
          archived: 1,
        })
      ).status,
      400,
    );
    assert.match((await json("/folders"))[0].name, /DROP TABLE/);
    assert.equal(
      (await api(`/items/${id}/folders/missing`, "PUT", { present: true }))
        .status,
      404,
    );
    assert.equal(
      (await api(`/items/${encodeURIComponent("' OR 1=1 --")}`)).status,
      404,
    );
    assert.equal(
      (await json(`/items?folderId=${encodeURIComponent("' OR 1=1 --")}`)).items
        .length,
      0,
    );
    const root = await fetch(base + "/", {
      headers: { "X-Auth-User": "web-test-owner" },
    });
    assert.equal(root.status, 200);
    assert.match(root.headers.get("content-type"), /text\/html/);
    assert.match(
      root.headers.get("content-security-policy"),
      /script-src 'self'/,
    );
    const js = await fetch(base + "/assets/app.js", {
      headers: { "X-Auth-User": "web-test-owner" },
    });
    assert.equal(js.status, 200);
    assert.match(js.headers.get("content-type"), /javascript/);
    const css = await fetch(base + "/assets/app.css", {
      headers: { "X-Auth-User": "web-test-owner" },
    });
    assert.equal(css.status, 200);
    assert.match(css.headers.get("content-type"), /text\/css/);
    assert.equal((await fetch(base + "/")).status, 401);
    for (const path of [
      "/assets/..%2f..%2fpackage.json",
      "/assets/%2e%2e/%2e%2e/schema.ts",
      "/%2e%2e%2fdata/stash-backend",
      "/assets/app.js.map",
      "/.env",
      "/api/not-a-page",
    ]) {
      const response = await new Promise((resolve, reject) => {
        const req = httpRequest(
          base,
          { path, headers: { "X-Auth-User": "web-test-owner" } },
          (res) => {
            res.resume();
            resolve(res);
          },
        );
        req.on("error", reject);
        req.end();
      });
      assert.equal(response.statusCode, 404, path);
    }
  },
);

test(
  "real WS API ↔ actual native replica projection, edits, archives, membership generations and add-wins folder masks",
  { timeout: 45000 },
  async (t) => {
    const { base, port, api, json } = await launch(t);
    const h = await createNativeHarness();
    t.after(() => h.cleanup());
    const app = h.load("src/db/database.ts"),
      replica = h.load("src/db/syncReplica.ts"),
      items = h.load("src/db/items.ts");
    await app.withAppDb(async (db) => {
      await app.ensureCrsqliteLoaded(db);
      await replica.seedSyncReplicaOwned(db, false);
    });
    const site = await app.withAppDb(
      async (db) => (await db.getFirstAsync("SELECT crsql_site_id() AS id")).id,
    );
    const { StashReplica } = h.load("src/db/syncClient.ts");
    const adapter = new StashReplica("app", site);
    t.after(async () => {
      adapter.close(false);
      await adapter.waitForPendingChanges();
    });
    const health = await (await fetch(base + "/healthz")).json();
    const protocol = Buffer.from("room=stash-backend")
      .toString("base64")
      .replace(/=+$/, "");
    const ws = new WebSocket(`ws://127.0.0.1:${port}/sync`, protocol, {
      headers: { "X-Auth-User": "web-test-owner" },
    });
    t.after(() => ws.terminate());
    let incoming = Promise.resolve(),
      remote,
      started = false,
      failure;
    ws.on("message", (data) => {
      const msg = decode(new Uint8Array(data));
      if (msg._tag === tags.StartStreaming) {
        remote = msg.excludeSites[0];
        started = true;
      }
      if (msg._tag === tags.Changes)
        incoming = incoming
          .then(() =>
            adapter.applyChangesetAndSetLastSeen(msg.changes, msg.sender, [
              msg.changes.at(-1)[5],
              0,
            ]),
          )
          .catch((error) => {
            failure = error;
          });
    });
    await once(ws, "open");
    ws.send(
      encode({
        _tag: tags.AnnouncePresence,
        sender: site,
        lastSeens: [],
        schemaName: health.schema,
        schemaVersion: BigInt(health.schemaVersion),
      }),
    );
    await waitFor(() => started);
    let sent = 0n;
    async function upload() {
      const changes = await adapter.pullChangeset([sent, 0], [remote], false);
      if (!changes.length) return;
      ws.send(
        encode({ _tag: tags.Changes, sender: site, since: [sent, 0], changes }),
      );
      sent = changes.reduce((v, c) => (c[5] > v ? c[5] : v), 0n);
      await waitFor(async () => {
        const res = await fetch(
          base +
            `/sync/status?clientSiteId=${Buffer.from(site).toString("hex")}`,
          { headers: { "X-Auth-User": "web-test-owner" } },
        );
        return BigInt((await res.json()).clientSeenVersion) >= sent;
      });
    }
    async function project(check) {
      await waitFor(async () => {
        await incoming;
        if (failure) throw failure;
        return app.withAppDb(check);
      });
      await app.withAppDb(async (db) => {
        await replica.markSyncSnapshotCompleteOwned(db);
        await replica.projectSyncReplicaToLocalOwned(db);
      });
    }
    const { id: folderId } = await json("/folders", "POST", {
      name: "From web",
    });
    const { id } = await json("/items", "POST", {
      type: "text",
      title: "Web title",
      content: "Web plaintext <script>alert(1)</script>",
    });
    await json(`/items/${id}/folders/${folderId}`, "PUT", { present: true });
    await project(async (db) =>
      Boolean(
        await db.getFirstAsync(
          "SELECT 1 FROM sync_item_folders WHERE item_id=? AND folder_id=?",
          id,
          folderId,
        ),
      ),
    );
    assert.equal(
      (await items.getItemById(id)).uri,
      "Web plaintext <script>alert(1)</script>",
    );
    assert.deepEqual(Array.from((await items.getItemById(id)).folder_ids), [
      folderId,
    ]);
    await items.updateItemTitle(id, "Edited natively");
    await upload();
    assert.equal((await json(`/items/${id}`)).title, "Edited natively");
    await items.updateItemTitle(id, "Zulu native conflict");
    await json(`/items/${id}`, "PATCH", { title: "Alpha web conflict" });
    await upload();
    assert.equal(
      (await json(`/items/${id}`)).title,
      "Zulu native conflict",
      "equal-clock scalar edits use CRSQLite's value conflict resolution",
    );
    await project(
      async (db) =>
        (await db.getFirstAsync("SELECT title FROM sync_items WHERE id=?", id))
          ?.title === "Zulu native conflict",
    );
    assert.equal((await items.getItemById(id)).title, "Zulu native conflict");
    await items.saveItem(
      {
        id: "native-created",
        type: "url",
        uri: "https://example.com/native",
        title: "Native link",
        created_at: 1,
        folder_ids: [],
      },
      [folderId],
    );
    await upload();
    const nativeCreated = await json("/items/native-created");
    assert.equal(nativeCreated.content, "https://example.com/native");
    assert.deepEqual(nativeCreated.folderIds, [folderId]);
    await json(`/items/${id}`, "PATCH", {
      content: "Web edit",
      archived: true,
    });
    await project(
      async (db) =>
        (
          await db.getFirstAsync(
            "SELECT content, archived_at FROM sync_items WHERE id=?",
            id,
          )
        )?.content === "Web edit" &&
        (
          await db.getFirstAsync(
            "SELECT archived_at FROM sync_items WHERE id=?",
            id,
          )
        )?.archived_at !== null,
    );
    assert.equal((await items.getItemById(id)).uri, "Web edit");
    assert.ok((await items.getItemById(id)).archived_at);
    await items.unarchiveItem(id);
    await upload();
    assert.equal((await json(`/items/${id}`)).archived_at, null);
    // Concurrent native fresh add vs web remove: web removes only observed generations.
    await app.withAppDb(async (db) => {
      await db.runAsync(
        "INSERT INTO sync_item_folders(membership_id,item_id,folder_id,added_at) VALUES ('concurrent',?,?,2)",
        id,
        folderId,
      );
    });
    await json(`/items/${id}/folders/${folderId}`, "PUT", { present: false });
    assert.deepEqual((await json(`/items/${id}`)).folderIds, []);
    await upload();
    assert.deepEqual((await json(`/items/${id}`)).folderIds, [folderId]);
    await json(`/items/${id}/folders/${folderId}`, "PUT", { present: false });
    await json(`/items/${id}/folders/${folderId}`, "PUT", { present: true });
    await project(async (db) => {
      const rows = await db.getAllAsync(
        "SELECT membership_id FROM sync_item_folders WHERE item_id=? AND folder_id=?",
        id,
        folderId,
      );
      return rows.length === 1 && rows[0].membership_id !== "concurrent";
    });
    assert.deepEqual(Array.from((await items.getItemById(id)).folder_ids), [
      folderId,
    ]);
    // Mask a native folder tombstone with a concurrent surviving generation; read matches reconciliation.
    await app.withAppDb(async (db) => {
      await db.runAsync(
        "UPDATE sync_folders SET deleted=1 WHERE id=?",
        folderId,
      );
    });
    await upload();
    assert.ok((await json("/folders")).some((f) => f.id === folderId));
    await json(`/folders/${folderId}`, "PATCH", { archived: true });
    assert.ok((await json("/folders"))[0].archived_at);
    // Native media carries no portable content; legacy bad links stay non-clickable.
    await app.withAppDb(async (db) => {
      await db.runAsync(
        "INSERT INTO sync_items(id,type,content,media_id,title) VALUES ('media','image','file:///private/picture.jpg','media','Photo')",
      );
      await db.runAsync(
        "INSERT INTO sync_items(id,type,content,article_html) VALUES ('bad-link','url','javascript:alert(1)','<script>private</script>')",
      );
      await db.runAsync(
        "INSERT INTO sync_item_folders(membership_id,item_id,folder_id) VALUES ('orphan','missing-item',?)",
        folderId,
      );
    });
    await upload();
    const media = await json("/items/media");
    assert.equal(media.content, null);
    assert.equal(media.mediaUnavailable, true);
    assert.ok(!JSON.stringify(media).includes("private"));
    assert.equal(
      (await api("/items/media", "PATCH", { title: "No" })).status,
      409,
    );
    const badLink = await json("/items/bad-link");
    assert.equal(badLink.content, null);
    assert.ok(!("article_html" in badLink));
    assert.equal((await json(`/items?folderId=${folderId}`)).items.length, 2);
    await items.deleteItem(id);
    await upload();
    assert.equal((await api(`/items/${id}`)).status, 404);
    assert.ok(
      (await json("/folders")).some((f) => f.id === folderId),
      "API mutation preserved the native add-wins folder revival",
    );
    // HTTP requests with no WS ref exercise repeated cold cache acquisitions concurrently.
    const closed = once(ws, "close");
    ws.close();
    await closed;
    await Promise.all(
      Array.from({ length: 105 }, (_, n) =>
        json("/items", "POST", {
          type: "url",
          content: `https://example.com/${n}`,
        }),
      ),
    );
    const page1 = await json("/items"),
      page2 = await json("/items?offset=100");
    assert.equal(page1.items.length, 100);
    assert.equal(page1.hasMore, true);
    assert.equal(page2.hasMore, false);
    assert.ok(page2.items.length >= 5);
    assert.ok(
      page1.items.every(
        (row) => !page2.items.some((other) => other.id === row.id),
      ),
    );
  },
);
