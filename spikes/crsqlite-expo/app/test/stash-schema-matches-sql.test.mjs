import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../stashSchema.ts", import.meta.url), "utf8");
const candidateSql = readFileSync(new URL("../../schemas/stash-sync-v1.sql", import.meta.url), "utf8");
const runtimeSql = runtimeSource.match(/String\.raw`([\s\S]*?)`;/)?.[1];

test("Android runtime schema is an exact copy of the reviewed candidate SQL", () => {
  assert.ok(runtimeSql, "could not find STASH_SCHEMA_SQL template literal");
  assert.equal(runtimeSql, candidateSql);
});
