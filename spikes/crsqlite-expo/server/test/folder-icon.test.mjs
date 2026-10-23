import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { extensionPath } from "@vlcn.io/crsqlite";
import { folderIcon } from "../src/folder-icon.ts";
import { launch } from "./web-helpers.mjs";

const initials = ["🅰️", "📚", "💾", "📄", "✉️", "📁", "🎮", "🏠", "💡", "📓", "🔑", "🔗", "🎵", "📰", "🌐", "📌", "❓", "🔴", "⭐", "🏷️", "🔵", "🎬", "🌊", "❌", "💛", "⚡"];

test("effective folder icon matches native saved/Inbox/trimmed initial/generic fallbacks", () => {
  for (const icon of [undefined, null, ""]) {
    assert.equal(folderIcon({ id: "inbox", name: "Renamed", icon }), "📥");
    for (const [i, expected] of initials.entries())
      assert.equal(folderIcon({ id: "other", name: `  ${String.fromCharCode(65 + i)} shelf  `, icon }), expected);
    for (const name of ["", "   ", "123", "🧑🏽‍💻", "éclair"])
      assert.equal(folderIcon({ id: "other", name, icon }), "📁");
  }
  for (const icon of ["🧑🏽‍💻", "🏳️‍🌈", "👨‍👩‍👧‍👦", "✉️⭐", " ", "<img src=x onerror=alert(1)>"])
    assert.equal(folderIcon({ id: "inbox", name: "Articles", icon }), icon);
});

test("folder API derives null/empty fallbacks without changing stored icons or their CRR clocks on reads/rename/archive", async t => {
  const { json, api, tmp } = await launch(t);
  const db = new Database(tmp + "/stash-backend");
  db.loadExtension(extensionPath);
  t.after(() => db.close());
  const fixtures = [
    ["inbox", "Renamed inbox", null, "📥"],
    ["empty-inbox-name", "  Inbox", "", "💡"],
    ["null-name", "  Articles", null, "🅰️"],
    ["empty-name", "  Books", "", "📚"],
    ["null-generic", "123", null, "📁"],
    ["empty-generic", "  ", "", "📁"],
    ["saved", "Custom", "🧑🏽‍💻🏳️‍🌈", "🧑🏽‍💻🏳️‍🌈"],
  ];
  for (const [id, name, icon] of fixtures)
    db.prepare("INSERT INTO sync_folders(id,name,icon,created_at) VALUES (?,?,?,1)").run(id, name, icon);
  assert.equal((await json("/folders")).find(f => f.id === "inbox").icon, "📥");
  db.prepare("UPDATE sync_folders SET icon='' WHERE id='inbox'").run();
  assert.equal((await json("/folders")).find(f => f.id === "inbox").icon, "📥", "empty Inbox icon also falls back by id");
  assert.equal(db.prepare("SELECT icon FROM sync_folders WHERE id='inbox'").get().icon, "");
  db.prepare("UPDATE sync_folders SET icon=NULL WHERE id='inbox'").run();
  const metadata = () => db.prepare(`SELECT hex(pk) AS pk, val, col_version, db_version, hex(site_id) AS site_id, cl, seq FROM crsql_changes WHERE "table"='sync_folders' AND cid='icon' ORDER BY pk`).all();
  const before = metadata();
  for (const [id, , icon, expected] of fixtures) {
    assert.equal((await json("/folders")).find(f => f.id === id).icon, expected);
    await json(`/folders/${id}`, "PATCH", { name: "  Zebra", archived: true });
    const folder = (await json("/folders")).find(f => f.id === id);
    assert.equal(folder.icon, icon || (id === "inbox" ? "📥" : "⚡"));
    assert.ok(folder.archived_at);
    assert.equal(db.prepare("SELECT icon FROM sync_folders WHERE id=?").get(id).icon, icon);
    await json(`/folders/${id}`, "PATCH", { archived: false });
  }
  assert.deepEqual(metadata(), before);
  assert.equal((await api("/folders/saved", "PATCH", { icon: "📌" })).status, 400, "no icon editing API added");
});
