import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { receiveImage, blobPath } from "../src/media-store.ts";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stash-media-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = await sharp({ create: { width: 20, height: 15, channels: 3, background: "cyan" } }).png().toBuffer();
  return { root: path.join(root, "media"), bytes, sha: hash(bytes) };
}
const stream = bytes => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });

test("first CAS ancestor publication is fsynced before durable file/manifest publication", async t => {
  const { root, bytes, sha } = await fixture(t);
  const original = fs.promises.open; const events = [];
  fs.promises.open = async (...args) => {
    const fd = await original(...args); const sync = fd.sync.bind(fd);
    fd.sync = async () => { events.push(String(args[0])); return sync(); };
    return fd;
  };
  syncBuiltinESMExports();
  try {
    await receiveImage(root, stream(bytes), sha);
    const shaParent = events.indexOf(path.join(root, "sha256"));
    const rootAfter = events.findIndex((entry, i) => i > shaParent && entry === root);
    const originalPublication = events.findIndex(entry => entry === path.dirname(blobPath(root, sha)));
    assert.ok(shaParent >= 0 && rootAfter > shaParent && originalPublication > rootAfter, JSON.stringify(events));
  } finally { fs.promises.open = original; syncBuiltinESMExports(); }
});

for (const failurePoint of ["write-sync", "publication-sync"]) test(`synthetic ${failurePoint} disk failure leaves no completed upload and retry verifies retained immutable bytes`, async t => {
  const { root, bytes, sha } = await fixture(t); const original = fs.promises.open;
  let injected = false, shardSyncs = 0;
  fs.promises.open = async (...args) => {
    const fd = await original(...args); const sync = fd.sync.bind(fd); const name = String(args[0]);
    fd.sync = async () => {
      if (name === path.dirname(blobPath(root, sha))) shardSyncs++;
      const target = failurePoint === "write-sync" ? name.startsWith(path.join(root, "temporary") + path.sep) : name === path.dirname(blobPath(root, sha)) && shardSyncs === 2;
      if (!injected && target) { injected = true; const error = new Error("synthetic disk failure"); error.code = "ENOSPC"; throw error; }
      return sync();
    }; return fd;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(receiveImage(root, stream(bytes), sha), /synthetic disk failure/); }
  finally { fs.promises.open = original; syncBuiltinESMExports(); }
  assert.equal(injected, true); assert.deepEqual(await readdir(path.join(root, "temporary")), []);
  const result = await receiveImage(root, stream(bytes), sha);
  assert.equal(result.original_sha, sha); assert.deepEqual(await readFile(blobPath(root, sha)), bytes);
});

test("aggregate receiver limit and cancellation bound stalled uploads without leaking completion slots", async t => {
  const { root, bytes, sha } = await fixture(t);
  const a = new AbortController(), b = new AbortController();
  const never = () => new ReadableStream({ start(c) { c.enqueue(bytes.subarray(0, 10)); } });
  const first = receiveImage(root, never(), sha, a.signal); const second = receiveImage(root, never(), sha, b.signal);
  const rejected = Promise.allSettled([first, second]);
  await assert.rejects(receiveImage(root, stream(bytes), sha), error => error.status === 503);
  a.abort(); b.abort();
  assert.ok((await rejected).every(result => result.status === "rejected"));
  assert.deepEqual(await readdir(path.join(root, "temporary")), []);
  assert.equal((await receiveImage(root, stream(bytes), sha)).original_sha, sha);
});

test("stuck decoder is killed at its deadline and cannot publish an incomplete image", { timeout: 25000 }, async t => {
  const { root, bytes, sha } = await fixture(t);
  const script = path.join(path.dirname(root), "synthetic-stuck-decoder.mjs");
  await writeFile(script, "setInterval(()=>{},1000);");
  const original = childProcess.fork; let worker;
  childProcess.fork = (_module, _args, options) => { worker = original(script, [], options); return worker; };
  syncBuiltinESMExports();
  try { await assert.rejects(receiveImage(root, stream(bytes), sha), error => error.status === 422); }
  finally { childProcess.fork = original; syncBuiltinESMExports(); worker?.kill("SIGKILL"); }
  assert.equal(worker.signalCode, "SIGKILL");
  assert.deepEqual(await readdir(path.join(root, "temporary")), []);
  await assert.rejects(readFile(blobPath(root, sha)), { code: "ENOENT" });
});
