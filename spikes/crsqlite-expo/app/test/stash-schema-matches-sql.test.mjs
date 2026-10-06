import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeSource = readFileSync(new URL("../stashSchema.ts", import.meta.url), "utf8");
const candidateSql = readFileSync(new URL("../../schemas/stash-sync-v1.sql", import.meta.url), "utf8");
const productionSource = readFileSync(new URL("../../../../src/db/syncReplica.ts", import.meta.url), "utf8");
const runtimeSql = runtimeSource.match(/String\.raw`([\s\S]*?)`;/)?.[1];
const productionSql = productionSource.match(/export const SYNC_SCHEMA_SQL = String\.raw`([\s\S]*?)`;/)?.[1];

function replicatedTables(sql) {
  return new Map([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (sync_\w+) \(([\s\S]*?)\);/g)]
    .map(([, name, columns]) => [name, columns.replace(/--.*$/gm, "").replace(/\s+/g, " ").trim()]));
}

test("Android spike, reviewed SQL, and Stash runtime keep CRR tables aligned", () => {
  assert.ok(runtimeSql, "could not find STASH_SCHEMA_SQL template literal");
  assert.ok(productionSql, "could not find SYNC_SCHEMA_SQL template literal");
  assert.equal(runtimeSql, candidateSql);
  assert.deepEqual(replicatedTables(productionSql), replicatedTables(candidateSql));
});
