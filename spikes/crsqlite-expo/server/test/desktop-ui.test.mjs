import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { App, ItemEditor, ItemReader } from "../web/App.tsx";
import { ItemCard } from "../web/components.tsx";
import { FolderForm } from "../web/FolderForm.tsx";
const flush = async (fn) =>
  act(async () => {
    await fn?.();
    await new Promise((r) => setImmediate(r));
  });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function fixture(t, initial = "/?folder=f1") {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
  };
  const listeners = new Map(),
    storage = new Map();
  const state = {
    folders: [
      { id: "f1", name: "Reading", archived_at: null, layout: "list" },
      { id: "f2", name: "Other", archived_at: null, layout: "grid" },
    ],
    items: Array.from({ length: 3 }, (_, n) => ({
      id: `i${n}`,
      type: "text",
      title: `Note ${n}`,
      content: "Original body",
      archived_at: null,
      folderIds: ["f1", "f2"],
      mediaUnavailable: false,
    })),
    calls: [],
    failWrite: false,
    confirm: false,
    prompts: 0,
  };
  const location = new URL(initial, "http://localhost");
  const history = [];
  const update = (_, __, url) => {
    const next = new URL(url, location);
    location.href = next.href;
    history.push(url);
  };
  globalThis.window = {
    location,
    history: { pushState: update, replaceState: update },
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
    confirm: () => {
      state.prompts++;
      return state.confirm;
    },
    addEventListener: (key, fn) => listeners.set(key, fn),
    removeEventListener: (key) => listeners.delete(key),
    setInterval: () => 1,
    clearInterval() {},
  };
  globalThis.document = {
    hidden: false,
    querySelectorAll: () => [],
    querySelector: () => null,
  };
  globalThis.fetch = async (url, options) => {
    state.calls.push({ url, ...options });
    if (options.method !== "GET") {
      if (state.failWrite)
        return Response.json(
          { error: "Synthetic write failed" },
          { status: 503 },
        );
      const data = JSON.parse(options.body);
      if (url.includes("/folders/") && options.method === "PATCH")
        Object.assign(
          state.folders.find((f) => url.endsWith(f.id)),
          data,
        );
      else if (options.method === "POST")
        state.items.push({
          ...state.items[0],
          ...data,
          id: "new",
          folderIds: data.folderId ? [data.folderId] : [],
        });
      else {
        const item = state.items.find((i) => url.endsWith(i.id));
        Object.assign(
          item,
          data,
          data.archived === undefined
            ? {}
            : { archived_at: data.archived ? 1 : null },
        );
      }
      return Response.json({
        id: options.method === "POST" ? "new" : url.split("/").at(-1),
      });
    }
    if (url === "/api/folders") return Response.json(state.folders);
    if (url.startsWith("/api/items?")) {
      const q = new URL(url, location).searchParams;
      return Response.json({
        items: state.items.filter(
          (i) =>
            (i.archived_at !== null) === (q.get("archived") === "true") &&
            (!q.get("folderId") || i.folderIds.includes(q.get("folderId"))),
        ),
        hasMore: false,
      });
    }
    const item = state.items.find((i) => url.endsWith(i.id));
    return item
      ? Response.json(item)
      : Response.json({ error: "Missing" }, { status: 404 });
  };
  let renderer;
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    Object.assign(globalThis, previous);
  });
  await flush(() => {
    renderer = create(React.createElement(App));
  });
  const buttons = () => renderer.root.findAllByType("button");
  const button = (label) =>
    buttons().find(
      (b) => b.props["aria-label"] === label || b.children.includes(label),
    );
  const select = (id) =>
    flush(() =>
      buttons()
        .find((b) => b.props["data-item-id"] === id)
        .props.onClick(),
    );
  return {
    state,
    renderer,
    buttons,
    button,
    select,
    location,
    listeners,
    storage,
  };
}

test("folder layout persists only after success; All items preference remains browser-local", async (t) => {
  const h = await fixture(t);
  h.state.failWrite = true;
  await flush(() => h.button("Grid layout").props.onClick());
  assert.equal(h.button("List layout").props["aria-pressed"], true);
  h.state.failWrite = false;
  await flush(() => h.button("Grid layout").props.onClick());
  assert.equal(h.button("Grid layout").props["aria-pressed"], true);
  assert.equal(h.state.folders[0].layout, "grid");
  const ul = h.renderer.root.findByProps({
    className: "items grid grid-cols-2 gap-3",
  });
  assert.equal(ul.children.length, 3);
  await h.select("i1");
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i1");
  await h.select("i1");
  assert.equal(
    h.renderer.root.findByType(ItemReader).props.item.id,
    "i1",
    "reselecting the same item must not clear detail without a new fetch",
  );
  await flush(() => h.button("List layout").props.onClick());
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i1");
  await flush(() => h.button("All items").props.onClick());
  const before = h.state.calls.filter((c) => c.method !== "GET").length;
  await flush(() => h.button("Grid layout").props.onClick());
  assert.equal(h.storage.get("stash.all.layout"), "grid");
  assert.equal(h.state.calls.filter((c) => c.method !== "GET").length, before);
});

test("deep link, selection, browser history and dirty draft navigation protection", async (t) => {
  const h = await fixture(t, "/?folder=f1&item=i1");
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i1");
  await flush(() => h.listeners.get("popstate")());
  assert.equal(
    h.renderer.root.findByType(ItemReader).props.item.id,
    "i1",
    "same-URL history entries must not blank the reader",
  );
  await flush(() => h.button("Edit item").props.onClick());
  await flush(() => h.renderer.root.findByType(ItemEditor).props.onDirty(true));
  await h.select("i2");
  assert.equal(h.state.prompts, 1);
  assert.equal(h.renderer.root.findByType(ItemEditor).props.item.id, "i1");
  h.location.search = "?folder=f2&item=i0";
  await flush(() => h.listeners.get("popstate")());
  assert.ok(h.location.search.includes("item=i1"));
  h.state.confirm = true;
  h.location.search = "?folder=f2&item=i0";
  await flush(() => h.listeners.get("popstate")());
  assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i0");
  assert.ok(!h.location.href.includes("Original"));
});

test("create attaches current folder, archive selects next, Undo restores, toggle retains folder and hides create", async (t) => {
  const h = await fixture(t);
  await flush(() => h.button("New item").props.onClick());
  await flush(() =>
    h.renderer.root
      .findByType(ItemEditor)
      .props.onSave({ type: "text", content: "Filed immediately" }),
  );
  const create = h.state.calls.find((c) => c.method === "POST");
  assert.equal(JSON.parse(create.body).folderId, "f1");
  await h.select("i1");
  await flush(() => h.button("Archive item").props.onClick());
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i2");
  assert.ok(h.button("Undo"));
  await flush(() => h.button("Undo").props.onClick());
  assert.equal(h.state.items[1].archived_at, null);
  await h.select("i1");
  await flush(() => h.button("Archive item").props.onClick());
  await flush(() => h.button("Archive").props.onClick());
  assert.ok(
    h.location.search.includes("folder=f1") &&
      h.location.search.includes("archive=1"),
  );
  assert.equal(h.button("New item"), undefined);
  assert.equal(h.button("New folder"), undefined);
  assert.ok(h.buttons().some((b) => b.props.title === "Reading"));
  await h.select("i1");
  await flush(() => h.button("Unarchive item").props.onClick());
  assert.equal(h.renderer.root.findAllByType(ItemReader).length, 0);
  assert.equal(h.state.items[1].archived_at, null);
});

test("cards use escaped excerpts and media placeholders, without unsafe URLs or a spanning odd card", () => {
  const html = renderToStaticMarkup(
    React.createElement(ItemCard, {
      item: {
        id: "x",
        type: "text",
        title: null,
        excerpt: "<script>not HTML</script>",
        mediaUnavailable: false,
      },
      selected: false,
      onSelect() {},
      onKeyDown() {},
    }),
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes("<script") && !html.includes("col-span"));
});

test("folder rename keeps a frozen baseline and skips unchanged writes after a remote refresh", async (t) => {
  const previous = globalThis.FormData;
  globalThis.FormData = class extends Map {
    constructor(form) {
      super(Object.entries(form.fields));
    }
  };
  let renderer,
    saved = "not submitted";
  t.after(async () => {
    if (renderer) await act(() => renderer.unmount());
    globalThis.FormData = previous;
  });
  const props = {
    initialName: "Observed name",
    busy: false,
    onSave: (value) => {
      saved = value;
    },
    onDirty() {},
    onCancel() {},
  };
  await flush(() => {
    renderer = create(React.createElement(FolderForm, props));
  });
  await flush(() =>
    renderer.update(
      React.createElement(FolderForm, {
        ...props,
        initialName: "Concurrent phone name",
      }),
    ),
  );
  assert.equal(
    renderer.root.findByType("input").props.defaultValue,
    "Observed name",
  );
  await flush(() =>
    renderer.root
      .findByType("form")
      .props.onSubmit({
        preventDefault() {},
        currentTarget: { fields: { name: "Observed name" } },
      }),
  );
  assert.equal(saved, null);
});
