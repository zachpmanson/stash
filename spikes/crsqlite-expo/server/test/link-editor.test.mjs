import { Field } from "@base-ui/react/field";
import { Select } from "@base-ui/react/select";
import { Input } from "@base-ui/react/input";
import { clickEvent } from "./renderer-base-ui.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { App, ItemEditor, ItemReader } from "../web/App.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async fn => act(async () => { await fn?.(); await new Promise(resolve => setImmediate(resolve)); });
const event = fields => ({ preventDefault() {}, currentTarget: { fields } });
const sample = { id: "link", type: "url", title: "Existing title", content: "https://example.com/old", description: null, article_text: null, created_at: 1, archived_at: null, folderIds: [], mediaUnavailable: false };

async function fixture(t, app = false, item = null) {
  const old = { fetch: globalThis.fetch, window: globalThis.window, document: globalThis.document, FormData: globalThis.FormData };
  globalThis.FormData = class extends Map { constructor(form) { super(Object.entries(form.fields)); } };
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {}, confirm: () => true };
  globalThis.document = { hidden: false };
  const state = { calls: [], items: [], saved: [], cancelled: 0, title: "Fetched & decoded page title", failMetadata: false, failSave: false, pending: null };
  globalThis.fetch = async (url, options) => {
    state.calls.push({ url, ...options });
    if (url === "/api/link-title") {
      if (state.pending) await state.pending;
      if (state.failMetadata) throw Error("Metadata unavailable");
      return Response.json({ title: state.title });
    }
    if (url === "/api/items" && options.method === "POST") {
      if (state.failSave) return Response.json({ error: "Save failed" }, { status: 503 });
      state.items.push({ ...sample, ...JSON.parse(options.body) });
      return Response.json({ id: "link" });
    }
    if (url === "/api/folders") return Response.json([]);
    if (url.startsWith("/api/items?")) return Response.json({ items: state.items, hasMore: false });
    return Response.json(state.items[0]);
  };
  let renderer;
  const editorProps = { item, busy: false, onSave: data => state.saved.push(data), onCancel: () => state.cancelled++ };
  await flush(() => { renderer = create(React.createElement(app ? App : ItemEditor, app ? {} : editorProps)); });
  t.after(async () => { await flush(() => renderer.unmount()); Object.assign(globalThis, old); });
  const button = label => renderer.root.findAllByType("button").find(n => n.props["aria-label"] === label || n.children.join("") === label);
  if (app) await flush(() => button("New item").props.onClick(clickEvent()));
  const editor = () => renderer.root.findByType(ItemEditor);
  const setType = type => flush(() => editor().findByType(Select.Root).props.onValueChange(type));
  const submit = fields => flush(() => editor().findByType("form").props.onSubmit(event(fields)));
  return { state, renderer, button, editor, setType, submit, editorProps };
}

test("new link has a required URL field, hides/disables title, preserves content/title drafts across modes and never submits stale title", async t => {
  const h = await fixture(t);
  assert.equal(h.editor().findByProps({ name: "title" }).parent.props.hidden, false);
  assert.equal(h.editor().findByType("textarea").props.maxLength, 48000);
  await flush(() => h.editor().findByType("textarea").props.onChange({ target: { value: "https://example.com/draft" } }));
  await h.setType("url");
  const input = h.editor().findByProps({ name: "content" });
  assert.equal(input.type, Input);
  assert.equal(input.findByType("input").props.type, "url");
  assert.equal(input.props.type, "url");
  assert.equal(input.props.required, true);
  assert.equal(input.props.maxLength, 4096);
  assert.equal(input.props.defaultValue, "https://example.com/draft");
  assert.equal(input.parent.findByType(Field.Label).props.children, "URL (required)");
  const title = h.editor().findByProps({ name: "title" });
  assert.equal(title.parent.props.hidden, true);
  assert.equal(title.props.disabled, true);
  assert.match(h.editor().findAllByProps({ className: "field-help" }).map(n => n.children.join("")).join(""), /title is fetched when you save/);
  await h.submit({ type: "url", content: "https://example.com/draft", title: "Must not leak from Text" });
  assert.deepEqual(h.state.saved, [{ type: "url", content: "https://example.com/draft" }]);
  await h.setType("text");
  assert.equal(h.editor().findByType("textarea").props.defaultValue, "https://example.com/draft");
  assert.equal(h.editor().findByProps({ name: "title" }), title, "same title control retains its draft");
  assert.equal(title.props.disabled, false);
  await h.setType("image");
  assert.equal(h.editor().findByProps({ name: "title" }).parent.props.hidden, false);
  assert.equal(h.editor().findAllByType("textarea").length, 0);
  assert.equal(h.editor().findByProps({ type: "file" }).props.accept, "image/jpeg,image/png,image/webp");
});

test("editing an existing link retains editable title and dirty-only content/title patches", async t => {
  const h = await fixture(t, false, sample);
  assert.equal(h.editor().findAllByType(Select.Root).length, 0);
  assert.equal(h.editor().findByProps({ name: "title" }).parent.props.hidden, false);
  await h.submit({ title: sample.title, content: sample.content });
  await h.submit({ title: "Edited title", content: sample.content });
  assert.deepEqual(h.state.saved, [{}, { title: "Edited title" }]);
  assert.equal(h.state.calls.length, 0);
});

for (const failMetadata of [false, true]) test(`App saves fetched title or URL fallback, never hidden stale title (metadata failure=${failMetadata})`, async t => {
  const h = await fixture(t, true);
  h.state.failMetadata = failMetadata;
  await h.setType("url");
  await h.submit({ type: "url", content: "https://example.com/article", title: "Stale text title" });
  const writes = h.state.calls.filter(c => c.method === "POST");
  assert.deepEqual(writes.map(c => c.url), ["/api/link-title", "/api/items"]);
  assert.deepEqual(JSON.parse(writes[0].body), { url: "https://example.com/article" });
  assert.deepEqual(JSON.parse(writes[1].body), { type: "url", content: "https://example.com/article", title: failMetadata ? "https://example.com/article" : h.state.title });
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.title, failMetadata ? "https://example.com/article" : h.state.title);
});

test("metadata waits within App mutation lock, ignores duplicate submits/cancel, and save error retains draft for retry", async t => {
  const h = await fixture(t, true);
  await h.setType("url");
  let release;
  h.state.pending = new Promise(resolve => { release = resolve; });
  h.state.failSave = true;
  const fields = { type: "url", content: "https://example.com/article" };
  const originalSubmit = h.editor().findByType("form").props.onSubmit;
  await flush(() => { originalSubmit(event(fields)); originalSubmit(event(fields)); });
  assert.equal(h.editor().props.busy, true);
  await flush(() => h.button("Cancel").props.onClick(clickEvent()));
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 1);
  assert.equal(h.state.calls.filter(c => c.url === "/api/link-title").length, 1);
  assert.equal(h.state.calls.filter(c => c.url === "/api/items").length, 0);
  await flush(() => release());
  assert.equal(h.editor().props.busy, false);
  assert.match(h.renderer.root.findByProps({ role: "alert" }).children.join(""), /Save failed/);
  assert.equal(h.editor().findByType(Select.Root).props.value, "url");
  assert.equal(h.editor().findByProps({ name: "content" }).props.type, "url", "failed save retains link mode");
  h.state.failSave = false;
  await h.submit(fields);
  assert.equal(h.state.items.length, 1);
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
});

test("Cancel before Save performs no metadata request or item write", async t => {
  const h = await fixture(t, true);
  await h.setType("url");
  await flush(() => h.button("Cancel").props.onClick(clickEvent()));
  assert.equal(h.state.calls.filter(c => c.method !== "GET").length, 0);
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
});
