import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { launch } from "./web-helpers.mjs";

test("web folders sort alphabetically ignoring case, independent of age, icon and archive state", async t => {
  const { json, tmp } = await launch(t);
  const db = new Database(tmp + "/stash-backend");
  db.loadExtension(extensionPath);
  t.after(() => db.close());
  const insert = db.prepare("INSERT INTO sync_folders(id,name,icon,created_at,archived_at) VALUES (?,?,?,?,?)");
  insert.run("z", "Zebra", "🅰️", 50, null);
  insert.run("b", "books", "⚡", 40, null);
  insert.run("a2", "apple", "📁", 30, null);
  insert.run("a1", "Apple", "⚡", 20, null);
  insert.run("archived", "Archive", "📁", 10, 1);
  const ids = async () => (await json("/folders")).map(f => f.id);
  assert.deepEqual(await ids(), ["a1", "a2", "archived", "b", "z"]);

  await json("/folders/z", "PATCH", { name: "Aardvark" });
  assert.deepEqual(await ids(), ["z", "a1", "a2", "archived", "b"], "rename moves the folder to its alphabetical position");
  await json("/folders/b", "PATCH", { archived: true });
  assert.deepEqual(await ids(), ["z", "a1", "a2", "archived", "b"], "archiving does not change the shared alphabetical order");
});
