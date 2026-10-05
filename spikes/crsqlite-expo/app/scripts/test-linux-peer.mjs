import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = path.dirname(fileURLToPath(import.meta.url));
const extension = path.resolve(here, "../native/x86_64-linux/crsqlite.so");
const columns = '"table", pk, cid, val, col_version, db_version, site_id, cl, seq';

function newReplica() {
  const db = new DatabaseSync(":memory:", { allowExtension: true });
  db.loadExtension(extension, "sqlite3_crsqlite_init");
  db.exec("CREATE TABLE notes (id TEXT PRIMARY KEY NOT NULL, body TEXT NOT NULL DEFAULT '')");
  db.prepare("SELECT crsql_as_crr(?)").get("notes");
  return db;
}

function exchange(from, to) {
  const batch = from.prepare(`SELECT ${columns} FROM crsql_changes`).all();
  const insert = to.prepare(`INSERT INTO crsql_changes (${columns}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const row of batch) {
    insert.run(row.table, row.pk, row.cid, row.val, row.col_version, row.db_version, row.site_id, row.cl, row.seq);
  }
}

const a = newReplica();
const b = newReplica();
try {
  a.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").run("from-a", "offline on replica A");
  exchange(a, b);
  b.prepare("INSERT INTO notes (id, body) VALUES (?, ?)").run("from-b", "offline on replica B");
  exchange(b, a);

  const expected = [
    { id: "from-a", body: "offline on replica A" },
    { id: "from-b", body: "offline on replica B" },
  ];
  const rows = (db) => db.prepare("SELECT id, body FROM notes ORDER BY id").all().map(({ id, body }) => ({ id, body }));
  assert.deepEqual(rows(a), expected);
  assert.deepEqual(rows(b), expected);

  const backup = a.serialize();
  const restored = new DatabaseSync(":memory:", { allowExtension: true });
  try {
    restored.deserialize(backup);
    restored.loadExtension(extension, "sqlite3_crsqlite_init");
    assert.deepEqual(rows(restored), expected);
    assert.equal(restored.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name GLOB 'crsql_*'").get().n > 0, true);
  } finally {
    restored.prepare("SELECT crsql_finalize()").get();
    restored.close();
  }

  console.log("CR-SQLite extension load: PASS");
  console.log("Bidirectional independent-connection convergence: PASS");
  console.log("SQLite serialize/restore with CRR metadata: PASS");
} finally {
  a.prepare("SELECT crsql_finalize()").get();
  b.prepare("SELECT crsql_finalize()").get();
  a.close();
  b.close();
}
