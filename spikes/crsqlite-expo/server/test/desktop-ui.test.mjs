import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
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
    failPage: () => false,
    writeGate: null,
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
      await state.writeGate;
      if (state.failWrite)
        return Response.json(
          { error: "Synthetic write failed" },
          { status: 503 },
        );
      const data = JSON.parse(options.body);
      if (url.includes("/items/") && options.method === "PUT") {
        const [, , , itemId, , folderId] = url.split("/");
        const item = state.items.find((i) => i.id === itemId);
        item.folderIds = item.folderIds.filter((id) => id !== folderId);
        if (data.present) item.folderIds.push(folderId);
      } else if (url.includes("/folders/") && options.method === "PATCH")
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
      if (state.failPage(q))
        return Response.json({ error: "Synthetic page failed" }, { status: 503 });
      const matching = state.items.filter(
        (i) =>
          (i.archived_at !== null) === (q.get("archived") === "true") &&
          (!q.get("folderId") || i.folderIds.includes(q.get("folderId"))),
      );
      const offset = Number(q.get("offset") ?? 0);
      return Response.json({
        items: matching.slice(offset, offset + 100),
        hasMore: matching.length > offset + 100,
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
    className: "items grid grid-cols-2 gap-2",
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

// Exercise FolderForm's actual change handler, not a synthetic App dirty flag.
async function typeFolderDraft(h, name) {
  const previous = globalThis.FormData;
  globalThis.FormData = class extends Map {
    constructor(form) { super(Object.entries(form.fields)); }
  };
  try {
    await flush(() => h.renderer.root.findByType(FolderForm)
      .findByType("form").props.onChange({ currentTarget: { fields: { name } } }));
  } finally {
    globalThis.FormData = previous;
  }
}

for (const action of ["New folder", "Rename"]) {
  test(`${action} draft guards item-edit transition and editors are mutually exclusive`, async (t) => {
    const h = await fixture(t, "/?folder=f1&item=i1");
    await flush(() => h.button(action).props.onClick());
    await typeFolderDraft(h, "Unsaved folder draft");
    const form = h.renderer.root.findByType(FolderForm);
    await flush(() => h.button("Edit item").props.onClick());
    assert.equal(h.state.prompts, 1);
    assert.ok(h.renderer.root.findByType(FolderForm) === form, "folder form must survive rejected navigation");
    assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
    await flush(() => h.button("All items").props.onClick());
    assert.equal(h.state.prompts, 2);
    assert.equal(h.location.search, "?folder=f1&item=i1");
    let prevented = false;
    h.listeners.get("beforeunload")({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    h.state.confirm = true;
    await flush(() => h.button("Edit item").props.onClick());
    assert.equal(h.renderer.root.findAllByType(FolderForm).length, 0);
    assert.equal(h.renderer.root.findByType(ItemEditor).props.item.id, "i1");
    await flush(() => h.button("All items").props.onClick());
    assert.equal(h.state.prompts, 3, "accepted discard must not leave a stale folder dirty flag");
    assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
  });
}

test("new-folder form identity and dirty protection survive remote selected-folder removal", async (t) => {
  const h = await fixture(t, "/?folder=f1&item=i1");
  await flush(() => h.button("New folder").props.onClick());
  await typeFolderDraft(h, "Unrelated new folder draft");
  const form = h.renderer.root.findByType(FolderForm);
  h.state.folders = h.state.folders.filter(f => f.id !== "f1");
  await flush(() => h.button("Refresh").props.onClick());
  assert.equal(h.location.search, "");
  assert.ok(h.renderer.root.findByType(FolderForm) === form,
    "changing the filter must not remount the uncontrolled new-folder input");
  await flush(() => h.button("Archive").props.onClick());
  assert.equal(h.state.prompts, 1);
  assert.ok(h.renderer.root.findByType(FolderForm) === form, "folder form must survive rejected navigation");
});

test("remote folder removal still invalidates its owned rename draft", async (t) => {
  const h = await fixture(t);
  await flush(() => h.button("Rename").props.onClick());
  await typeFolderDraft(h, "Removed folder rename");
  h.state.folders = h.state.folders.filter(f => f.id !== "f1");
  await flush(() => h.button("Refresh").props.onClick());
  assert.equal(h.renderer.root.findAllByType(FolderForm).length, 0);
  await flush(() => h.button("Archive").props.onClick());
  assert.equal(h.state.prompts, 0);
});

test("Back to collection guards and explicitly closes a discarded folder draft", async (t) => {
  const h = await fixture(t, "/?folder=f1&item=i1");
  await flush(() => h.button("New folder").props.onClick());
  await typeFolderDraft(h, "Unsaved folder draft");
  await flush(() => h.button("Back to collection").props.onClick());
  assert.equal(h.state.prompts, 1);
  assert.equal(h.renderer.root.findAllByType(FolderForm).length, 1);
  h.state.confirm = true;
  await flush(() => h.button("Back to collection").props.onClick());
  assert.equal(h.renderer.root.findAllByType(FolderForm).length, 0);
  assert.equal(h.location.search, "?folder=f1");
});

const textOf = (node) => typeof node === "string" ? node :
  (node.children ?? []).map(textOf).join("");

test("collection toolbar groups layout choices with tooltips; compact list and two-column grid retain selection", async (t) => {
  const h = await fixture(t);
  const group = h.renderer.root.findByProps({ role: "group", "aria-label": "Collection layout" });
  assert.equal(group.findAllByType("button").length, 2);
  for (const label of ["List layout", "Grid layout"])
    assert.equal(h.button(label).props.title, label);
  assert.equal(h.renderer.root.findAllByProps({ className: "collection-heading" }).length, 1);
  const ul = h.renderer.root.findByType("ul");
  assert.match(ul.props.className, /flex flex-col/);
  const pane = { scrollTop: 320, querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 180 }) }) };
  ul.props.onFocusCapture({ currentTarget: { parentElement: pane }, target: { getBoundingClientRect: () => ({ top: 150 }) } });
  assert.equal(pane.scrollTop, 284, "focus obscured by the sticky toolbar is revealed");
  ul.props.onFocusCapture({ currentTarget: { parentElement: pane }, target: { getBoundingClientRect: () => ({ top: 240 }) } });
  assert.equal(pane.scrollTop, 284, "unobscured focus must not move the collection");
  await h.select("i1");
  await flush(() => h.button("Grid layout").props.onClick());
  assert.match(h.renderer.root.findByType("ul").props.className, /grid-cols-2/);
  assert.equal(h.renderer.root.findByType(ItemReader).props.item.id, "i1");
});

for (const archived of [false, true]) {
  test(`empty ${archived ? "archive" : "active"} CTA keeps folder and guards dirty folder draft`, async (t) => {
    const h = await fixture(t, `/?folder=f1${archived ? "&archive=1" : ""}`);
    h.state.items = [];
    await flush(() => h.button("Refresh").props.onClick());
    const empty = h.renderer.root.findByProps({ className: "empty" });
    const cta = empty.findByType("button");
    assert.equal(textOf(cta), archived ? "Back to collection" : "New item");
    if (!archived) {
      await flush(() => h.button("New folder").props.onClick());
      await typeFolderDraft(h, "Keep this draft");
      await flush(() => cta.props.onClick());
      assert.equal(h.state.prompts, 1);
      assert.equal(h.renderer.root.findAllByType(FolderForm).length, 1);
      assert.equal(h.renderer.root.findAllByType(ItemEditor).length, 0);
      h.state.confirm = true;
    }
    await flush(() => cta.props.onClick());
    assert.equal(h.location.search.includes("folder=f1"), true);
    assert.equal(h.location.search.includes("archive=1"), false);
    assert.equal(h.renderer.root.findAllByType(ItemEditor).length, archived ? 0 : 1);
  });
}

test("item and folder forms have one primary submit, secondary Cancel and disabled busy wording", async (t) => {
  let renderer;
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); });
  for (const [Component, extra, idle, busy] of [
    [ItemEditor, { item: null }, "Save item", "Saving…"],
    [ItemEditor, { item: { title: "Observed", content: "Body", type: "url" } }, "Save item", "Saving…"],
    [FolderForm, { initialName: null }, "Create folder", "Creating…"],
    [FolderForm, { initialName: "Observed" }, "Rename folder", "Saving…"],
  ]) {
    for (const saving of [false, true]) {
      await flush(() => {
        renderer?.unmount();
        renderer = create(React.createElement(Component, { ...extra, busy: saving, onSave() {}, onCancel() {}, onDirty() {} }));
      });
      const buttons = renderer.root.findAllByType("button");
      const primary = buttons.filter(b => b.props.className === "primary");
      assert.equal(primary.length, 1);
      assert.equal(primary[0].props.type, "submit");
      assert.equal(textOf(primary[0]), saving ? busy : idle);
      assert.equal(buttons[1].props.type, "button");
      assert.notEqual(buttons[1].props.className, "primary");
      assert.equal(Component === ItemEditor ? renderer.root.findByType("fieldset").props.disabled : primary[0].props.disabled, saving);
      if (Component === ItemEditor) {
        const title = renderer.root.findByProps({ name: "title" });
        const content = renderer.root.findByProps({ name: "content" });
        assert.match(textOf(title.parent), /Title \(optional\)/);
        assert.equal(title.props.required, undefined);
        assert.equal(content.props.required, true);
        assert.equal(content.props.rows, 6, "compact initial editor remains vertically resizable");
        const help = renderer.root.findByProps({ id: content.props["aria-describedby"] });
        assert.match(textOf(help), /required.*http:\/\/ or https:\/\//);
        assert.equal(content.props.maxLength, extra.item ? 4096 : 48000);
      }
    }
  }
});

test("Organise summary counts only existing memberships, including archived folders, and updates after mutation", async (t) => {
  const h = await fixture(t, "/?item=i1");
  h.state.folders[1].archived_at = 1;
  for (const [ids, expected] of [[[], "No folders"], [["f2", "missing"], "1 folder"], [["f1", "f2"], "2 folders"]]) {
    h.state.items[1].folderIds = ids;
    await flush(() => h.button("Refresh").props.onClick());
    assert.equal(textOf(h.renderer.root.findByType("summary")), `Folder membership: Organise · ${expected}`);
  }
  const checkbox = h.renderer.root.findAllByProps({ type: "checkbox" })[0];
  await flush(() => checkbox.props.onChange({ target: { checked: false } }));
  assert.equal(h.state.calls.at(-1).method, "GET");
  assert.equal(textOf(h.renderer.root.findByType("summary")), "Folder membership: Organise · 1 folder");
  assert.ok(h.state.calls.some(c => c.method === "PUT" && c.body === '{"present":false}'));
});

test("card labels are human Note/Link, while domains, untitled fallback and device-only media remain honest", () => {
  for (const [item, expected] of [
    [{ type: "text" }, "Note"], [{ type: "url" }, "Link"],
    [{ type: "url", domain: "example.com" }, "example.com"],
    [{ type: "image", mediaUnavailable: true }, "Media · available on device"],
  ]) {
    const html = renderToStaticMarkup(React.createElement(ItemCard, { item: { id: "label", ...item }, onSelect() {}, onKeyDown() {} }));
    assert.match(html, new RegExp(`<small><span class="card-kind">${expected}</span></small>`));
    if (item.type === "text") assert.match(html, /Untitled text/);
  }
});

test("safe external reader URL retains security attributes and associated visible new-tab hint; unsafe has neither", async (t) => {
  let renderer;
  t.after(async () => { if (renderer) await act(() => renderer.unmount()); });
  for (const content of ["https://example.com/" + "long".repeat(40), "javascript:alert(1)", "https://user:secret@example.com/"]) {
    await flush(() => {
      renderer?.unmount();
      renderer = create(React.createElement(ItemReader, { item: { type: "url", content } }));
    });
    const links = renderer.root.findAllByType("a");
    assert.equal(links.length, content.includes("long") ? 1 : 0);
    if (links.length) {
      assert.equal(links[0].props.href, content);
      assert.equal(links[0].props.target, "_blank");
      assert.equal(links[0].props.rel, "noopener noreferrer");
      assert.equal(textOf(renderer.root.findByProps({ id: links[0].props["aria-describedby"] })), "Opens in a new tab");
    } else assert.equal(renderer.root.findAllByProps({ className: "external-link-hint" }).length, 0);
  }
});

test("pagination shows loaded range without invented totals, blank zero range, or changing offset/history", async (t) => {
  const h = await fixture(t, "/?folder=f1&offset=100");
  h.state.items = Array.from({ length: 103 }, (_, n) => ({ ...h.state.items[0], id: `page-${n}` }));
  await flush(() => h.button("Refresh").props.onClick());
  const nav = h.renderer.root.findByProps({ "aria-label": "Item pages" });
  assert.match(textOf(nav), /Items 101–103/);
  assert.doesNotMatch(textOf(nav), / of /);
  assert.equal(h.button("Next").props.disabled, true);
  await flush(() => h.button("Previous").props.onClick());
  assert.equal(h.location.search, "?folder=f1");
  assert.match(textOf(h.renderer.root.findByProps({ "aria-label": "Item pages" })), /Items 1–100/);
  assert.equal(h.button("Previous").props.disabled, true);
  await flush(() => h.button("Next").props.onClick());
  assert.equal(h.location.search, "?folder=f1&offset=100");
  h.state.items = [];
  await flush(() => h.button("Refresh").props.onClick());
  assert.doesNotMatch(textOf(h.renderer.root.findByProps({ "aria-label": "Item pages" })), /Items|1–0/);
});

test("failed next page retains cards without a false range, even when mutations clear errors; retry commits its range", async (t) => {
  const h = await fixture(t);
  h.state.items = Array.from({ length: 103 }, (_, n) => ({ ...h.state.items[0], id: `page-${n}` }));
  await flush(() => h.button("Refresh").props.onClick());
  const range = () => textOf(h.renderer.root.findByProps({ "aria-label": "Item pages" }));
  const cards = () => h.renderer.root.findAllByType(ItemCard).map(c => c.props.item.id);
  const firstPage = cards();
  assert.equal(firstPage.length, 100);
  assert.match(range(), /Items 1–100/);
  h.state.failPage = q => q.get("offset") === "100";
  await flush(() => h.button("Next").props.onClick());
  assert.equal(h.location.search, "?folder=f1&offset=100");
  assert.match(textOf(h.renderer.root.findByProps({ role: "alert" })), /Synthetic page failed/);
  assert.equal(h.button("Refresh").props.disabled, false, "failed fetch has settled");
  assert.deepEqual(cards(), firstPage, "useful prior cards remain visible");
  assert.doesNotMatch(range(), /Items/, "old cards must not be labeled 101–200");
  // Focus/background retries must not accidentally authorize this route's range.
  await flush(() => h.listeners.get("focus")());
  assert.doesNotMatch(range(), /Items/);
  let release;
  h.state.writeGate = new Promise(resolve => { release = resolve; });
  await flush(() => h.button("Grid layout").props.onClick());
  assert.equal(h.renderer.root.findAllByProps({ role: "alert" }).length, 0, "unrelated mutation clears the error");
  assert.doesNotMatch(range(), /Items/, "range validity must not depend on error text");
  await flush(() => release());
  assert.doesNotMatch(range(), /Items/);
  h.state.failPage = () => false;
  await flush(() => h.button("Retry").props.onClick());
  assert.deepEqual(cards(), ["page-100", "page-101", "page-102"]);
  assert.match(range(), /Items 101–103/);
  assert.equal(h.location.search, "?folder=f1&offset=100");
  assert.equal(h.button("Next").props.disabled, true);
  // A failed refresh of the same page can truthfully describe retained records.
  h.state.failPage = () => true;
  await flush(() => h.listeners.get("focus")());
  assert.match(range(), /Items 101–103/);
  // Equal offsets in different folder/archive queries are not the same page.
  h.location.search = "?folder=f2&offset=100";
  await flush(() => h.listeners.get("popstate")());
  assert.doesNotMatch(range(), /Items/);
  h.location.search = "?folder=f1&archive=1&offset=100";
  await flush(() => h.listeners.get("popstate")());
  assert.doesNotMatch(range(), /Items/);
  assert.deepEqual(cards(), ["page-100", "page-101", "page-102"]);
});

test("primary default and hover colors meet WCAG AA for white normal-size text", async () => {
  const css = await readFile(new URL("../web/style.css", import.meta.url), "utf8");
  const luminance = hex => {
    const rgb = hex.match(/[a-f\d]{2}/gi).map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  assert.match(css.match(/\.primary\s*\{([^}]+)\}/)[1], /color:\s*white\s*;/);
  for (const selector of [/\.primary\s*\{([^}]+)\}/, /\.primary:hover:not\(:disabled\)\s*\{([^}]+)\}/]) {
    const color = css.match(selector)[1].match(/background:\s*(#[a-f\d]{6})\s*;/i)[1];
    const ratio = 1.05 / (luminance(color.slice(1)) + 0.05);
    assert.ok(ratio >= 4.5, `${color} white text contrast ${ratio.toFixed(3)} must be >= 4.5:1`);
  }
});

test("compact chrome removes slogans, keeps a mounted live region and bounded two-line card hierarchy", async (t) => {
  const h = await fixture(t);
  const status = h.renderer.root.findByProps({ role: "status" });
  assert.equal(status.props["aria-live"], "polite");
  assert.equal(textOf(status), "");
  const header = h.renderer.root.findByType("header");
  assert.doesNotMatch(textOf(header), /little space|later/);
  const heading = h.renderer.root.findByProps({ className: "collection-heading" });
  assert.equal(heading.findAllByType("h2").length, 1);
  assert.equal(heading.findAllByType("p").length, 0, "no duplicate eyebrow or slogan");
  assert.doesNotMatch(h.renderer.root.findByType("ul").props.className, /gap-/);
  assert.equal(h.button("Archive").props["aria-label"], "Archive");

  let card;
  await flush(() => { card = create(React.createElement(ItemCard, {
    item: { id: "preview", type: "text", title: "Full title", excerpt: "Useful bounded preview" },
    selected: true, onSelect() {}, onKeyDown() {},
  })); });
  t.after(() => act(() => card.unmount()));
  const title = card.root.findByProps({ className: "card-title" });
  assert.equal(title.props.title, "Full title");
  const preview = card.root.findByProps({ className: "card-excerpt" });
  assert.equal(preview.parent.type, "small", "preview shares the metadata line instead of a third block");
  assert.equal(textOf(preview), "Useful bounded preview");
  assert.equal(card.root.findByType("button").props["aria-pressed"], true);
});
