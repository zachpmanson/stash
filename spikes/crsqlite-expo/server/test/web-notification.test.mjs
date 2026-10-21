import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
const requireServer = createRequire(
  process.env.STASH_TEST_SERVER_ENTRY || import.meta.url,
);
const entry = requireServer.resolve("@vlcn.io/ws-server");
const { default: FSNotify } = await import(
  pathToFileURL(path.join(path.dirname(entry), "fs/FSNotify.js"))
);

test("explicit post-commit wakeup works without filesystem watcher events and detaches disposed peers", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "stash-notify-test-"));
  const notify = new FSNotify({ dbFolder: dir });
  try {
    await notify.shutdown(); // No watcher can rescue a missed same-process broadcast.
    let first = 0,
      second = 0,
      unrelated = 0;
    const remove = notify.addListener("stash-backend", () => {
      first++;
    });
    notify.addListener("stash-backend", () => {
      second++;
    });
    notify.addListener("other-room", () => {
      unrelated++;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const before = [first, second, unrelated];
    notify.notifyChanges("stash-backend");
    assert.deepEqual(
      [first, second, unrelated],
      [before[0] + 1, before[1] + 1, before[2]],
    );
    remove();
    notify.notifyChanges("stash-backend");
    assert.deepEqual(
      [first, second, unrelated],
      [before[0] + 1, before[1] + 2, before[2]],
    );
  } finally {
    await notify.shutdown();
    await rm(dir, { recursive: true, force: true });
  }
});

test("FSNotify runtime artifact matches patched TypeScript", async () => {
  const source = await readFile(
    path.join(path.dirname(entry), "../src/fs/FSNotify.ts"),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    fileName: "FSNotify.ts",
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
    },
  }).outputText;
  const actual = await readFile(
    path.join(path.dirname(entry), "fs/FSNotify.js"),
    "utf8",
  );
  const normalized = (value) =>
    value
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trimEnd();
  assert.equal(normalized(actual), normalized(compiled));
});
