import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { request } from "node:http";
import WebSocket from "ws";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { encode, tags } from "@vlcn.io/ws-common";

const root = path.resolve(import.meta.dirname, "..");

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function waitForHealth(port, child) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.output}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return response.json();
    } catch {}
    await delay(100);
  }
  throw new Error(`server did not become ready: ${child.output}`);
}

function launch(port, dataDir) {
  const child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      DATA_DIR: dataDir,
      SCHEMA_DIR: path.join(dataDir, "schemas"),
      ENABLE_TEST_ENDPOINTS: "1",
      AUTH_USER: "zach",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { child.output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { child.output += chunk; });
  return child;
}

async function stop(child) {
  child.kill("SIGTERM");
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
  let code;
  let signal;
  try { [code, signal] = await once(child, "exit"); }
  finally { clearTimeout(timeout); }
  assert.equal(signal, null, `server was killed instead of shutting down: ${child.output}`);
  assert.equal(code, 0, `server shutdown failed: ${child.output}`);
}

function websocketUpgrade(port, authenticated, includeProtocol = true) {
  return new Promise((resolve, reject) => {
    const req = request({
      host: "127.0.0.1", port, path: "/sync", method: "GET",
      headers: {
        Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
        ...(includeProtocol ? { "Sec-WebSocket-Protocol": Buffer.from("room=stash-backend").toString("base64").replace(/=+$/, "") } : {}),
        ...(authenticated ? { "X-Auth-User": "zach" } : {}),
      },
    });
    req.once("upgrade", (_response, socket) => resolve({ status: 101, socket }));
    req.once("response", (response) => {
      response.resume();
      resolve({ status: response.statusCode, socket: null });
    });
    req.once("error", reject);
    req.end();
  });
}

async function waitForLog(child, text) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (child.output.includes(text)) return;
    if (child.exitCode !== null) throw new Error(`server exited before log ${text}: ${child.output}`);
    await delay(25);
  }
  throw new Error(`timed out waiting for server log ${text}: ${child.output}`);
}

async function announceSyncPeer(port, schemaVersion, sender = new Uint8Array(randomBytes(16))) {
  const protocol = Buffer.from("room=stash-backend").toString("base64").replace(/=+$/, "");
  const socket = new WebSocket(`ws://127.0.0.1:${port}/sync`, protocol, {
    headers: { "X-Auth-User": "zach" },
  });
  await once(socket, "open");
  socket.send(encode({
    _tag: tags.AnnouncePresence,
    sender,
    lastSeens: [],
    schemaName: "stash-sync-v1.sql",
    schemaVersion: BigInt(schemaVersion),
  }));
  return socket;
}

async function postOfflineWrite(port) {
  const response = await fetch(`http://127.0.0.1:${port}/test/offline-write`, { method: "POST" });
  assert.equal(response.status, 200);
}

function openClientReplica() {
  const db = new Database(":memory:");
  db.loadExtension(extensionPath);
  db.exec(readFileSync(path.join(root, "../schemas/stash-sync-v1.sql"), "utf8"));
  const { siteId } = db.prepare("SELECT crsql_site_id() AS siteId").get();
  return { db, siteId };
}

function clientChanges(db, sinceVersion) {
  return db.prepare(`SELECT "table", pk, cid, val, col_version, db_version, cl, seq
    FROM crsql_changes WHERE db_version > ? ORDER BY db_version, seq`).all(sinceVersion).map((row) => [
    row.table, row.pk, row.cid, row.val, BigInt(row.col_version), BigInt(row.db_version), null,
    BigInt(row.cl), row.seq,
  ]);
}

async function waitForPeerVersion(port, clientSiteId, expectedVersion) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const response = await fetch(`http://127.0.0.1:${port}/sync/status?clientSiteId=${clientSiteId.toString("hex")}`, {
      headers: { "X-Auth-User": "zach" },
    });
    assert.equal(response.status, 200);
    const status = await response.json();
    if (BigInt(status.clientSeenVersion) >= BigInt(expectedVersion)) return status;
    await delay(50);
  }
  throw new Error(`server did not observe client version ${expectedVersion}`);
}

async function runDbAdmin(dataDir, ...args) {
  const child = spawn(process.execPath, [path.join(root, "scripts/db-admin.mjs"), ...args], {
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, SCHEMA_DIR: path.join(dataDir, "schemas") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { output += chunk; });
  const [code, signal] = await once(child, "exit");
  assert.equal(code, 0, `db-admin ${args.join(" ")} failed (${signal}): ${output}`);
  return JSON.parse(output.trim());
}

async function items(port) {
  const response = await fetch(`http://127.0.0.1:${port}/test/items`);
  assert.equal(response.status, 200);
  return response.json();
}

test("authenticates upgrades and drains an active peer before persistent restart", { timeout: 30_000 }, async (t) => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "stash-crsqlite-server-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const backupPath = `${dataDir}.backup.sqlite`;
  t.after(() => rm(backupPath, { force: true }));
  const port = await freePort();
  let child = launch(port, dataDir);
  let syncPeer;
  let active;
  t.after(() => { syncPeer?.terminate(); active?.terminate(); });
  t.after(async () => { if (child && child.exitCode === null && child.signalCode === null) await stop(child); });

  const health = await waitForHealth(port, child);
  assert.equal(health.ok, true);
  assert.equal(health.bind, "127.0.0.1");
  assert.equal(health.schema, "stash-sync-v1.sql");
  const clientSiteId = randomBytes(16).toString("hex");
  const unauthenticatedStatus = await fetch(`http://127.0.0.1:${port}/sync/status?clientSiteId=${clientSiteId}`);
  assert.equal(unauthenticatedStatus.status, 401, "sync status must require Caddy-stamped identity");
  const wrongIdentityStatus = await fetch(`http://127.0.0.1:${port}/sync/status?clientSiteId=${clientSiteId}`, {
    headers: { "X-Auth-User": "attacker" },
  });
  assert.equal(wrongIdentityStatus.status, 401, "sync status must reject an unexpected identity");
  const malformedSiteStatus = await fetch("http://127.0.0.1:" + port + "/sync/status?clientSiteId=xyz", {
    headers: { "X-Auth-User": "zach" },
  });
  assert.equal(malformedSiteStatus.status, 400, "sync status must reject malformed site IDs");
  const statusResponse = await fetch(`http://127.0.0.1:${port}/sync/status?clientSiteId=${clientSiteId}`, {
    headers: { "X-Auth-User": "zach" },
  });
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.schema, "stash-sync-v1.sql");
  assert.equal(status.clientSiteId, clientSiteId);
  assert.equal(status.clientSeenVersion, "0");
  assert.equal(status.serverVersion, "0");
  assert.ok(status.serverSiteId);
  assert.deepEqual(status.counts, { folders: 0, items: 0, memberships: 0, substitutions: 0, settings: 0 });
  await postOfflineWrite(port);
  const changedStatusResponse = await fetch(`http://127.0.0.1:${port}/sync/status?clientSiteId=${clientSiteId}`, {
    headers: { "X-Auth-User": "zach" },
  });
  const changedStatus = await changedStatusResponse.json();
  assert.equal(changedStatus.counts.items, 1);
  assert.ok(BigInt(changedStatus.serverVersion) > 0n);

  const malformed = await websocketUpgrade(port, false, false);
  assert.equal(malformed.status, 400, "malformed upgrades must be rejected without crashing the service");
  assert.equal((await fetch(`http://127.0.0.1:${port}/healthz`)).status, 200);

  const rejected = await websocketUpgrade(port, false);
  assert.equal(rejected.status, 401, "upgrade without Caddy identity must be rejected");
  const accepted = await websocketUpgrade(port, true);
  assert.equal(accepted.status, 101, "upgrade with stamped identity must be accepted");
  assert.ok(accepted.socket);
  accepted.socket.destroy();

  const client = openClientReplica();
  t.after(() => client.db.close());
  client.db.prepare("INSERT INTO sync_items (id, type, content, created_at) VALUES (?, 'text', ?, ?)")
    .run("client-status-item", "offline from the client", 1);
  const initialClientVersion = client.db.prepare("SELECT crsql_db_version() AS version").get().version;
  syncPeer = await announceSyncPeer(port, health.schemaVersion, client.siteId);
  await waitForLog(child, "AnnouncePresence for: stash-backend");
  syncPeer.send(encode({
    _tag: tags.Changes,
    sender: client.siteId,
    since: [0n, 0],
    changes: clientChanges(client.db, 0),
  }));
  const receivedInitial = await waitForPeerVersion(port, client.siteId, initialClientVersion);
  assert.equal(receivedInitial.counts.items, 2);
  assert.equal(receivedInitial.serverVersion, changedStatus.serverVersion,
    "client-authored changes should not advance that client's outbound server watermark");

  client.db.prepare("DELETE FROM sync_items WHERE id = ?").run("client-status-item");
  const afterDeleteVersion = client.db.prepare("SELECT crsql_db_version() AS version").get().version;
  syncPeer.send(encode({
    _tag: tags.Changes,
    sender: client.siteId,
    since: [BigInt(initialClientVersion), 0],
    changes: clientChanges(client.db, initialClientVersion),
  }));
  const receivedDelete = await waitForPeerVersion(port, client.siteId, afterDeleteVersion);
  assert.equal(receivedDelete.counts.items, 1, "client tombstone must remove the remote candidate row");

  await stop(child);
  child = null;
  syncPeer.terminate();

  const backup = await runDbAdmin(dataDir, "backup", backupPath);
  assert.equal(backup.schema, "stash-sync-v1.sql");
  assert.ok(backup.version);
  await rm(path.join(dataDir, "stash-backend"));
  const restore = await runDbAdmin(dataDir, "restore", backupPath);
  assert.equal(restore.schema, "stash-sync-v1.sql");

  child = launch(port, dataDir);
  await waitForHealth(port, child);
  assert.deepEqual(await items(port), [{
    id: "server-offline-item",
    type: "text",
    content: "written on the server while the app was offline",
    title: "Server offline item",
  }]);

  active = await announceSyncPeer(port, health.schemaVersion);
  await waitForLog(child, "AnnouncePresence for: stash-backend");
  await stop(child);
  child = null;
  active.terminate();
});
