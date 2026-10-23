import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { requireStillPng, PngPolicyError } from "../src/media-png.ts";
import { syntheticPng, pngChunk } from "./png-fixtures.mjs";
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stash-png-policy-")); t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, "synthetic.png");
  return async bytes => { await writeFile(file, bytes); return requireStillPng(file); };
}
test("scanner directly enforces exact PNG chunk bound without relying on decoder metadata limits", async t => {
  const scan = await fixture(t);
  await scan(await syntheticPng({ extraChunks: 4093 })); // IHDR + extras + IDAT + IEND = 4096
  await assert.rejects(scan(await syntheticPng({ extraChunks: 4094 })), /complexity/);
});
test("scanner rejects every animation control/frame type, not strings in ordinary chunk payloads", async t => {
  const scan = await fixture(t); const normal = await syntheticPng();
  const headerEnd = 8 + normal.readUInt32BE(8) + 12;
  for (const type of ["acTL", "fcTL", "fdAT"]) {
    const value = Buffer.concat([normal.subarray(0, headerEnd), pngChunk(type, Buffer.alloc(8)), normal.subarray(headerEnd)]);
    await assert.rejects(scan(value), error => error instanceof PngPolicyError && /Animated/.test(error.message));
  }
  await scan(await syntheticPng({ extraChunks: 1 })); // payload contains acTL literally
});
test("scanner rejects malformed signature, truncated/chunk-overflow and missing end structures", async t => {
  const scan = await fixture(t); const normal = await syntheticPng();
  await assert.rejects(scan(Buffer.from("not PNG at all")), /signature/);
  const oversized = Buffer.from(normal); oversized.writeUInt32BE(0xffffffff, 8);
  await assert.rejects(scan(oversized), /length/);
  await assert.rejects(scan(normal.subarray(0, -5)), /length|Incomplete/);
  await assert.rejects(scan(normal.subarray(0, -12)), /Incomplete/);
});
