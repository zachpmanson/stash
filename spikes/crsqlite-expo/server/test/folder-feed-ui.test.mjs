import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { folderFeedUrl, FolderFeedDialog } from "../web/FolderFeedDialog.tsx";
import { Spinner } from "../web/Spinner.tsx";
import { renderToStaticMarkup } from "react-dom/server";
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const fixture = (id = "f1") => ({ version: 1, policy: "always-on", enabled: true, backend: "https://feeds.example", url: `https://feeds.example/feeds/folders/${id}.atom`, limit: 50 });
const flush = async (fn) => act(async () => { await fn?.(); await new Promise(r => setImmediate(r)); });

test("feed URL accepts only always-on, enabled, clean canonical HTTPS and exact target paths", () => {
  assert.equal(folderFeedUrl(fixture(), "f1"), fixture().url);
  for (const data of [null, {}, { ...fixture(), enabled: false }, { ...fixture(), policy: undefined },
    { ...fixture(), url: "javascript:alert(1)" }, { ...fixture(), url: fixture("f2").url },
    { ...fixture(), url: fixture().url + "?token=secret" }, { ...fixture(), url: fixture().url + "#fragment" },
    { ...fixture(), url: "https://user:secret@feeds.example/feeds/folders/f1.atom" },
    { ...fixture(), backend: "https://user:secret@feeds.example" }, { ...fixture(), backend: "http://feeds.example" },
    { ...fixture(), backend: "https://feeds.example/" }, { ...fixture(), version: 2 },
    { ...fixture(), url: fixture().url + "/extra" }]) assert.throws(() => folderFeedUrl(data, "f1"));
});

test("actual shared Spinner uses Heroicons with aria-hidden, explicit static idle class", () => {
  const active = renderToStaticMarkup(React.createElement(Spinner));
  const idle = renderToStaticMarkup(React.createElement(Spinner, { active: false }));
  assert.match(active, /class="spinner"/);
  assert.match(active, /aria-hidden="true"/);
  assert.match(active, /viewBox="0 0 24 24"/);
  assert.match(idle, /class="spinner is-idle"/);
});

test("actual feed dialog is GET-only, ignores late target results, exposes readonly URL and manual copy fallback", async (t) => {
  const previous = { fetch: globalThis.fetch, document: globalThis.document };
  const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const calls = [], pending = new Map();
  globalThis.fetch = (url, options) => { calls.push({ url, ...options }); return new Promise(resolve => pending.set(url, resolve)); };
  globalThis.document = { querySelector: () => null };
  let copied = "", failCopy = true, renderer;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard: { writeText: async (value) => { if (failCopy) throw new Error("Denied"); copied = value; } } } });
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    Object.assign(globalThis, previous);
    if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor); else delete globalThis.navigator;
  });
  const props = { name: "Target", returnFocus: null, onClose() {} };
  await flush(() => { renderer = create(React.createElement(FolderFeedDialog, { ...props, id: "f1" })); });
  await flush(() => renderer.update(React.createElement(FolderFeedDialog, { ...props, id: "f2" })));
  await flush(() => pending.get("/api/folders/f1/feed")(Response.json(fixture())));
  assert.equal(renderer.root.findAllByType("input").length, 0, "late response must never expose previous target URL");
  await flush(() => pending.get("/api/folders/f2/feed")(Response.json(fixture("f2"))));
  const input = renderer.root.findByType("input");
  assert.equal(input.props.value, fixture("f2").url);
  assert.equal(input.props.readOnly, true);
  const copy = () => renderer.root.findAllByType("button").find(b => b.children.includes("Copy URL"));
  await flush(() => copy().props.onClick());
  assert.match(renderer.root.findByProps({ role: "alert" }).children.join(""), /copy it manually/);
  failCopy = false;
  await flush(() => copy().props.onClick());
  assert.equal(copied, fixture("f2").url);
  assert.ok(calls.every(c => c.method === "GET"));
  await flush(() => renderer.update(React.createElement(FolderFeedDialog, { ...props, id: "f3" })));
  await flush(() => pending.get("/api/folders/f3/feed")(Response.json({ ...fixture("f3"), policy: undefined })));
  assert.equal(renderer.root.findAllByType("input").length, 0);
  assert.match(renderer.root.findByProps({ role: "alert" }).children.join(""), /does not support always-on/);
});
