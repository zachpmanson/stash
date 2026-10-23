import test from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";

test("two maximum-policy RGBA decoders stay within the Stash process-family native-memory budget", { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stash-decoder-budget-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const input = path.join(directory, "synthetic-24mp.png");
  await sharp({ create: { width: 6000, height: 4000, channels: 4, background: "#ab1234aa" } }).png().toFile(input);
  const worker = process.env.STASH_TEST_SERVER_ENTRY ? path.join(path.dirname(process.env.STASH_TEST_SERVER_ENTRY), "media-worker.js") : path.resolve(import.meta.dirname, "../src/media-worker.ts");
  const results = await Promise.all([0, 1].map(async i => {
    const child = fork(worker, [input, path.join(directory, `preview-${i}`), path.join(directory, `thumb-${i}`)], {
      execArgv: [...(worker.endsWith(".ts") ? ["--import", "tsx"] : []), "--max-old-space-size=64"],
      env: { ...process.env, VIPS_CONCURRENCY: "1", MALLOC_ARENA_MAX: "2" }, stdio: ["ignore", "ignore", "pipe", "ipc"],
    });
    t.after(() => child.kill("SIGKILL"));
    let message, errors = ""; child.on("message", value => { message = value; }); child.stderr.on("data", value => { errors += value; });
    const [code, signal] = await once(child, "exit");
    assert.equal(code, 0, errors); assert.equal(signal, null); assert.equal(message.ok, true);
    assert.equal(message.width * message.height, 24_000_000);
    assert.ok(message.peakRssKiB < 384 * 1024, `decoder RSS ${message.peakRssKiB} KiB exceeds reserved 384 MiB`);
    return message.peakRssKiB;
  }));
  console.log(`synthetic max-policy decoder peak RSS KiB: ${results.join(', ')}; service hard cap is 1 GiB including parent`);
});
