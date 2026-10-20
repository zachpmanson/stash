import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { encode, tags } from "@vlcn.io/ws-common";

// Resolve through the tested server so these same checks can target the Nix package.
const requireServer = createRequire(process.env.STASH_TEST_SERVER_ENTRY || import.meta.url);
const dependencyEntry = requireServer.resolve("@vlcn.io/ws-server");
const dependencyFile = (name) => pathToFileURL(path.join(path.dirname(dependencyEntry), name)).href;
const { default: DBCache } = await import(dependencyFile("DBCache.js"));
const { default: DB, getResidentSchemaVersion } = await import(dependencyFile("DB.js"));
const { default: ConnectionBroker } = await import(dependencyFile("ConnectionBroker.js"));
const SQLite = createRequire(dependencyEntry)("better-sqlite3");
const config = { dbFolder: null, schemaFolder: "", pathPattern: /sync/ };

for (const name of ["DB", "DBCache"]) {
  test(`patched ${name} dist is reproducible from its TypeScript source`, async () => {
    const source = await readFile(new URL(`../src/${name}.ts`, dependencyFile("index.js")), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: `${name}.ts`,
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, sourceMap: true },
    });
    // Patch files trim trailing whitespace, including TypeScript's space before an inline comment.
    const normalized = (text) => text.split("\n").map((line) => line.trimEnd()).join("\n").trimEnd();
    assert.equal(normalized(await readFile(new URL(dependencyFile(`${name}.js`)), "utf8")), normalized(outputText));
  });
}

function deferred() {
  const { promise, resolve, reject } = Promise.withResolvers();
  return { promise, resolve, reject };
}

function fakeDB() {
  return {
    siteId: new Uint8Array(16),
    closes: 0,
    schemasMatch: (name, version) => name === "valid.sql" && version === 1n,
    close() { this.closes += 1; },
  };
}

for (const acquisitions of [1, 3]) {
  test(`failed factory evicts ${acquisitions} acquisition(s) without closing or unrefing a rejection`, async (t) => {
    const pending = deferred();
    const failure = new Error("factory failed");
    const db = fakeDB();
    let calls = 0;
    const cache = new DBCache(config, null, { createDB: () => ++calls === 1 ? pending.promise : Promise.resolve(db) });
    // A failed acquisition must not call unref: it could consume a replacement's ref.
    const unref = t.mock.method(cache, "unref");
    const results = Array.from({ length: acquisitions }, () => cache.getAndRef("room", "valid.sql", 1n));
    assert.equal(cache.__tests_only_checkRef("room"), acquisitions);
    const rejected = results.map((result) => assert.rejects(result, (error) => error === failure));
    pending.reject(failure);
    await Promise.all(rejected);
    assert.equal(cache.__tests_only_checkRef("room"), 0);
    assert.equal(unref.mock.callCount(), 0);
    await cache.destroy(); // No rejected promise remains to await/close.
    assert.equal(await cache.getAndRef("room", "valid.sql", 1n), db);
    assert.equal(calls, 2);
    assert.equal(cache.__tests_only_checkRef("room"), 1);
    await cache.unref("room");
    assert.equal(cache.__tests_only_checkRef("room"), 0);
    assert.equal(db.closes, 1);
  });
}

test("schema mismatch releases only its own ref while concurrent valid users retain the DB", async (t) => {
  const pending = deferred();
  const db = fakeDB();
  const cache = new DBCache(config, null, { createDB: () => pending.promise });
  const unref = t.mock.method(cache, "unref");
  const first = cache.getAndRef("room", "valid.sql", 1n);
  const wrongName = assert.rejects(cache.getAndRef("room", "wrong.sql", 1n), /schema name and version/);
  const wrongVersion = assert.rejects(cache.getAndRef("room", "valid.sql", 2n), /schema name and version/);
  const second = cache.getAndRef("room", "valid.sql", 1n);
  assert.equal(cache.__tests_only_checkRef("room"), 4);
  pending.resolve(db);
  await Promise.all([first, second, wrongName, wrongVersion]);
  assert.equal(unref.mock.callCount(), 2);
  assert.equal(cache.__tests_only_checkRef("room"), 2);
  assert.equal(db.closes, 0);
  await cache.unref("room");
  assert.equal(db.closes, 0);
  await cache.unref("room");
  assert.equal(db.closes, 1);
  assert.equal(cache.__tests_only_checkRef("room"), 0);
  await cache.destroy();
  assert.equal(db.closes, 1);
});

test("broker releases a successful delayed acquisition once after malformed frame and repeated close", async () => {
  const pending = deferred();
  const db = fakeDB();
  const cache = new DBCache(config, null, { createDB: () => pending.promise });
  const ws = new EventEmitter();
  ws.terminate = () => ws.emit("close");
  const broker = new ConnectionBroker({ ws, dbCache: cache, room: "room" });
  // Calling the registered listener directly lets us await its async boundary deterministically.
  const onMessage = ws.listeners("message")[0];
  const setup = onMessage(encode({ _tag: tags.AnnouncePresence, sender: new Uint8Array(16),
    lastSeens: [], schemaName: "valid.sql", schemaVersion: 1n }));
  assert.equal(cache.__tests_only_checkRef("room"), 1);
  await onMessage(new Uint8Array());
  broker.close();
  ws.emit("close");
  pending.resolve(db);
  await setup;
  // SyncConnection.close calls async unref; wait for its final close microtask.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.__tests_only_checkRef("room"), 0);
  assert.equal(db.closes, 1);
  await cache.destroy();
  assert.equal(db.closes, 1);
});

test("DB constructor closes SQLite handles for early and schema failures, then permits retry", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stash-crsqlite-constructor-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const schema = await readFile(new URL("../../schemas/stash-sync-v1.sql", import.meta.url), "utf8");
  await writeFile(path.join(directory, "valid.sql"), schema);
  const dbConfig = { ...config, dbFolder: directory, schemaFolder: directory };
  const version = getResidentSchemaVersion("valid.sql", dbConfig);
  const handles = [];
  const close = SQLite.prototype.close;
  t.mock.method(SQLite.prototype, "close", function (...args) {
    handles.push(this);
    return close.apply(this, args);
  });
  const earlyFailure = new Error("load extension failed");
  const load = t.mock.method(SQLite.prototype, "loadExtension", () => { throw earlyFailure; });
  assert.throws(() => new DB(dbConfig, null, "early", "valid.sql", version), (error) => error === earlyFailure);
  load.mock.restore();
  assert.throws(() => new DB(dbConfig, null, "wrong-name", "missing.sql", version), /ENOENT/);
  assert.throws(() => new DB(dbConfig, null, "wrong-version", "valid.sql", version + 1n), /client requested/);
  assert.equal(handles.length, 3, "each constructor failure must close its handle exactly once");
  assert.ok(handles.every((handle) => !handle.open));
  const recovered = new DB(dbConfig, null, "wrong-version", "valid.sql", version);
  assert.equal(recovered.schemasMatch("valid.sql", version), true);
  recovered.close();
  assert.equal(handles.length, 4);
  assert.ok(handles.every((handle) => !handle.open));
});
