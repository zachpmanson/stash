import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

test("better-sqlite3 statements survive allocation-driven GC", () => {
  const db = new Database(":memory:");
  let allocations = [];

  // Node 24.19+ headers can make ObjectWrap finalizers abort during GC.
  // Keep statement wrappers short-lived and allocation pressure high so V8
  // exercises the affected finalizer path (Node issue #65446).
  for (let i = 0; i < 300_000; i++) {
    assert.equal(db.prepare("SELECT ? AS value").get(i).value, i);
    allocations.push({ i });
    if (allocations.length > 1_000) allocations = [];
  }

  db.close();
});
