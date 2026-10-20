import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { createServer } from "node:net";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { cryb64 } from "@vlcn.io/ws-common";

const root = path.resolve(import.meta.dirname, "..");
const schemaName = "stash-sync-v1.sql";
const schemaSql = await readFile(path.join(root, "../schemas", schemaName), "utf8");
const schemaVersion = cryb64(schemaSql);
const otherSql = schemaSql.replace("  title TEXT DEFAULT NULL,", "  title TEXT DEFAULT NULL,\n  rollback_only TEXT DEFAULT NULL,");
assert.notEqual(otherSql, schemaSql);

const cases = [
  { name: "unexpected schema identity", schema: "other.sql", version: schemaVersion, ddl: schemaSql },
  { name: "unexpected schema version", schema: schemaName, version: schemaVersion + 1n, ddl: schemaSql },
  { name: "different persisted DDL/version", schema: schemaName, version: cryb64(otherSql), ddl: otherSql },
  { name: "missing schema metadata", ddl: schemaSql },
  { name: "unexpected resident schema file", schema: schemaName, version: schemaVersion, ddl: schemaSql, resident: otherSql },
  { name: "unrecognized non-CRR database", plain: true },
];

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return String(port);
}

for (const fixture of cases) {
  test(`startup rejects ${fixture.name} without modifying DB or resident DDL`, { timeout: 10_000 }, async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "stash-crsqlite-preflight-"));
    let child;
    try {
      const schemaDir = path.join(dataDir, "schemas");
      await mkdir(schemaDir);
      const dbPath = path.join(dataDir, "stash-backend");
      const schemaPath = path.join(schemaDir, schemaName);
      await writeFile(schemaPath, fixture.resident ?? fixture.ddl ?? schemaSql);
      const db = new Database(dbPath);
      try {
        if (fixture.plain) {
          db.exec("CREATE TABLE unrelated (value TEXT); INSERT INTO unrelated VALUES ('preserve me')");
        } else {
          db.loadExtension(extensionPath);
          db.exec(fixture.ddl);
          db.prepare("INSERT INTO sync_items (id, type, content, title) VALUES (?, 'text', ?, ?)")
            .run("preserved-item", "original content", "original title");
          if (fixture.ddl === otherSql) db.exec("UPDATE sync_items SET rollback_only = 'preserve this column'");
          if (fixture.schema) {
            db.prepare("INSERT OR REPLACE INTO crsql_master (key, value) VALUES ('schema_name', ?)").run(fixture.schema);
            db.prepare("INSERT OR REPLACE INTO crsql_master (key, value) VALUES ('schema_version', ?)").run(fixture.version);
          }
        }
      } finally { db.close(); }
      const beforeDb = await readFile(dbPath);
      const beforeSchema = await readFile(schemaPath);
      const entry = process.env.STASH_TEST_SERVER_ENTRY;
      child = spawn(process.execPath, entry ? [entry] : [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], {
        cwd: root,
        env: { ...process.env, PORT: await freePort(), DATA_DIR: dataDir, SCHEMA_DIR: schemaDir, ENABLE_TEST_ENDPOINTS: "0" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8").on("data", chunk => { output += chunk; });
      child.stderr.setEncoding("utf8").on("data", chunk => { output += chunk; });
      const [code, signal] = await once(child, "exit", { signal: AbortSignal.timeout(5_000) });
      assert.equal(signal, null, output);
      assert.notEqual(code, 0, `unexpected startup success: ${output}`);
      assert.match(output, /schema mismatch|refusing to overwrite|no such table: crsql_master/, output);
      assert.doesNotMatch(output, /server\.listening|Watching .* for changes/, "reject before factory/watcher startup");
      assert.deepEqual(await readFile(dbPath), beforeDb, "persistent database bytes must be unchanged");
      assert.deepEqual(await readFile(schemaPath), beforeSchema, "resident schema bytes must be unchanged");
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
      await rm(dataDir, { recursive: true, force: true });
    }
  });
}
