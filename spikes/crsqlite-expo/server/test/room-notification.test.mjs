import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { internal } from "@vlcn.io/ws-server";

const appSchema = await readFile(new URL("../../app/schema.ts", import.meta.url), "utf8");
const serverSchema = await readFile(new URL("../schema.ts", import.meta.url), "utf8");

function roomFrom(source) {
  return source.match(/DATABASE_ROOM\s*=\s*["']([^"']+)["']/)?.[1];
}

test("app/server room name survives ws-server filesystem watcher normalization", () => {
  const appRoom = roomFrom(appSchema);
  const serverRoom = roomFrom(serverSchema);
  assert.ok(appRoom, "app schema must declare DATABASE_ROOM");
  assert.equal(serverRoom, appRoom, "app and server must use the same room");
  assert.equal(internal.fsUtil.fileEventNameToDbId(path.join("/data", appRoom)), appRoom);
  assert.equal(internal.fsUtil.fileEventNameToDbId(path.join("/data", `${appRoom}-wal`)), appRoom);
});
