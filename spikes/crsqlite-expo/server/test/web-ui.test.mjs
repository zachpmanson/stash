import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { App, ItemReader, safeLink } from "../web/App.tsx";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sample = {
  id: "i1",
  type: "text",
  title: "A text",
  content: "<script>alert('x')</script>",
  description: null,
  article_text: null,
  archived_at: null,
  folderIds: [],
  mediaUnavailable: false,
};

test("plaintext rendering, link validation and media placeholders never emit unsafe markup or private URLs", () => {
  const html = renderToStaticMarkup(
    React.createElement(ItemReader, {
      item: {
        ...sample,
        title: "<img src=x onerror=x>",
        article_text: "<iframe>article</iframe>",
      },
    }),
  );
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;iframe&gt;"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<script"));
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "file:///private",
    "https://user:secret@example.com",
    "//example.com",
  ]) {
    assert.equal(safeLink(url), null);
    const markup = renderToStaticMarkup(
      React.createElement(ItemReader, {
        item: { ...sample, type: "url", content: url },
      }),
    );
    assert.ok(!markup.includes("href="));
  }
  const link = renderToStaticMarkup(
    React.createElement(ItemReader, {
      item: { ...sample, type: "url", content: "https://example.com/a" },
    }),
  );
  assert.match(link, /rel="noopener noreferrer"/);
  const media = renderToStaticMarkup(
    React.createElement(ItemReader, {
      item: {
        ...sample,
        content: "file:///private/photo",
        mediaUnavailable: true,
      },
    }),
  );
  assert.match(media, /Media unavailable/);
  assert.ok(!media.includes("private"));
});

test("component flows: loading, read, create, edit, membership, archive, filters, errors and retry", async () => {
  const previous = {
    fetch: globalThis.fetch,
    window: globalThis.window,
    document: globalThis.document,
  };
  const calls = [],
    listeners = new Map();
  globalThis.window = {
    addEventListener: (event, fn) => listeners.set(event, fn),
    removeEventListener: (event) => listeners.delete(event),
    setInterval: () => 1,
    clearInterval() {},
  };
  globalThis.document = { hidden: false };
  const folders = [
    { id: "f1", name: "Reading", icon: "📁", archived_at: null },
  ];
  let item = { ...sample },
    fail = false,
    pending;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options });
    if (pending) await pending;
    if (fail)
      return new Response(JSON.stringify({ error: "Unavailable" }), {
        status: 503,
      });
    let result;
    if (options.method !== "GET") {
      const data = JSON.parse(options.body);
      if (url.endsWith("/folders/f1"))
        item = { ...item, folderIds: data.present ? ["f1"] : [] };
      else
        item = {
          ...item,
          ...data,
          ...(data.archived === undefined
            ? {}
            : { archived_at: data.archived ? 1 : null }),
        };
      result = { id: "i1" };
    } else if (url === "/api/folders") result = folders;
    else if (url.startsWith("/api/items?"))
      result = { items: [item], hasMore: false };
    else result = item;
    return new Response(JSON.stringify(result), {
      status: options.method === "POST" ? 201 : 200,
    });
  };
  let renderer;
  const flush = async (fn) =>
    act(async () => {
      await fn?.();
      await new Promise((resolve) => setImmediate(resolve));
    });
  const buttons = () => renderer.root.findAllByType("button");
  const button = (label) =>
    buttons().find((node) => node.props['aria-label'] === label || node.children.join("") === label);
  try {
    let release;
    pending = new Promise((resolve) => {
      release = resolve;
    });
    await flush(() => {
      renderer = create(React.createElement(App));
    });
    assert.match(JSON.stringify(renderer.toJSON()), /Loading…/);
    pending = null;
    await flush(() => release());
    const itemButton = buttons().find(
      (node) => node.props["data-item-id"] === 'i1',
    );
    await flush(() => itemButton.props.onClick());
    assert.ok(renderer.root.findByType(ItemReader));
    await flush(() => button("Edit item").props.onClick());
    await flush(() =>
      renderer.root
        .find(
          (node) =>
            typeof node.type === "function" && node.type.name === "ItemEditor",
        )
        .props.onSave({ title: "Edited", content: "Changed" }),
    );
    assert.equal(item.content, "Changed");
    await flush(() =>
      renderer.root
        .findAllByType("input")
        .find(
          (node) =>
            node.props.type === "checkbox" &&
            node.props.checked === false &&
            node.props.onChange,
        )
        .props.onChange({ target: { checked: true } }),
    );
    assert.deepEqual(item.folderIds, ["f1"]);
    await flush(() => button("Archive item").props.onClick());
    assert.equal(item.archived_at, 1);
    assert.equal(renderer.root.findAllByType(ItemReader).length, 0);
    await flush(() => buttons().find(node => node.props['aria-pressed'] === false && node.props['aria-label'] === 'Archive').props.onClick());
    await flush(() => buttons().find(node => node.props['data-item-id'] === 'i1').props.onClick());
    assert.ok(button("Unarchive item"));
    await flush(() => button("Unarchive item").props.onClick());
    await flush(() => buttons().find(node => node.props['aria-pressed'] === true && node.props['aria-label'] === 'Archive').props.onClick());
    await flush(() => button("New item").props.onClick());
    await flush(() =>
      renderer.root
        .find(
          (node) =>
            typeof node.type === "function" && node.type.name === "ItemEditor",
        )
        .props.onSave({
          type: "url",
          title: "Link",
          content: "https://example.com/",
        }),
    );
    assert.ok(
      calls.some((call) => call.url === "/api/items" && call.method === "POST"),
    );
    assert.ok(
      calls
        .filter((call) => call.method !== "GET")
        .every(
          (call) =>
            call.headers["X-Stash-Request"] === "1" &&
            call.credentials === "same-origin",
        ),
    );
    await flush(() => buttons().find(node => node.props.title === 'Reading').props.onClick());
    assert.ok(calls.some((call) => call.url.includes("folderId=f1")));
    fail = true;
    await flush(() => button("Refresh").props.onClick());
    assert.match(
      renderer.root.findByProps({ role: "alert" }).children.join(""),
      /Unavailable/,
    );
    fail = false;
    await flush(() => button("Retry").props.onClick());
    assert.equal(renderer.root.findAllByProps({ role: "alert" }).length, 0);
  } finally {
    if (renderer) await act(() => renderer.unmount());
    Object.assign(globalThis, previous);
  }
});
