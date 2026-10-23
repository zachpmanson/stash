import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { act, create } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, IconButton } from "../web/components/controls.tsx";
import { Icon } from "../web/components/Icon.tsx";
import { Icon as LegacyIcon, FolderNavigation } from "../web/components.tsx";
import { AppHeader } from "../web/components/AppHeader.tsx";
import { ItemToolbar } from "../web/components/ItemToolbar.tsx";
import { readRoute, routeUrl } from "../web/App.tsx";
import {
  readRoute as hookReadRoute,
  useWebRoute,
} from "../web/hooks/useWebRoute.ts";
import { useLayoutPreference } from "../web/hooks/useLayoutPreference.ts";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = async (fn) =>
  act(async () => {
    await fn();
  });

async function mount(t, element, options) {
  let renderer;
  await flush(() => {
    renderer = create(element, options);
  });
  t.after(() => flush(() => renderer.unmount()));
  return renderer;
}

test("shared buttons forward native attributes, currentTarget and the actual button ref without wrappers", async (t) => {
  const ref = React.createRef();
  const nativeButton = { nodeName: "BUTTON", focus() {} };
  let current;
  const renderer = await mount(
    t,
    React.createElement(
      IconButton,
      {
        ref,
        "aria-label": "Actions",
        title: "Actions",
        disabled: true,
        "aria-pressed": true,
        "aria-expanded": false,
        "aria-haspopup": "menu",
        "data-target": "f1",
        onClick: (e) => {
          current = e.currentTarget;
        },
      },
      React.createElement(Icon, { name: "more" }),
    ),
    {
      createNodeMock: (element) =>
        element.type === "button" ? nativeButton : null,
    },
  );
  const button = renderer.root.findByType("button");
  assert.equal(ref.current, nativeButton);
  assert.equal(button.props.type, "button");
  for (const [key, value] of Object.entries({
    disabled: true,
    title: "Actions",
    "aria-label": "Actions",
    "aria-pressed": true,
    "aria-expanded": false,
    "aria-haspopup": "menu",
    "data-target": "f1",
  }))
    assert.equal(button.props[key], value);
  button.props.onClick({ currentTarget: nativeButton });
  assert.equal(current, nativeButton);
  assert.equal(renderer.toJSON().type, "button");
  assert.equal(renderer.root.findByType("svg").props["aria-hidden"], "true");
  await flush(() =>
    renderer.update(
      React.createElement(
        Button,
        { type: "submit", name: "save", value: "yes" },
        "Save",
      ),
    ),
  );
  assert.equal(renderer.root.findByType("button").props.type, "submit");
  assert.equal(renderer.root.findByType("button").props.name, "save");
  assert.equal(renderer.root.findByType("button").props.value, "yes");
});

test("extracted header keeps the mobile folder DOM ref; toolbar retains pressed group and busy semantics", async (t) => {
  const ref = React.createRef(),
    nativeButton = { focus() {} };
  const h = await mount(
    t,
    React.createElement(AppHeader, {
      folderButton: ref,
      sidebarOpen: true,
      busy: true,
      loading: false,
      archived: true,
      onToggleSidebar() {},
      onToggleArchive() {},
      onRefresh() {},
      onNew() {},
    }),
    {
      createNodeMock: (e) =>
        e.type === "button" && e.props["aria-label"] === "Open folders"
          ? nativeButton
          : null,
    },
  );
  assert.equal(ref.current, nativeButton);
  assert.equal(h.root.findAllByType("button").length, 3);
  assert.equal(h.root.findAllByType("button")[0].props["aria-expanded"], true);
  const changes = [];
  const toolbar = await mount(
    t,
    React.createElement(ItemToolbar, {
      folderName: "Shelf",
      archived: true,
      layout: "grid",
      busy: false,
      onLayout: (value) => changes.push(value),
    }),
  );
  const group = toolbar.root.findByProps({ role: "group" });
  assert.equal(group.props["aria-label"], "Collection layout");
  const buttons = group.findAllByType("button");
  assert.deepEqual(
    buttons.map((b) => b.props["aria-pressed"]),
    [false, true],
  );
  assert.ok(
    buttons.every(
      (b) =>
        b.props.title === b.props["aria-label"] && b.props.type === "button",
    ),
  );
  await flush(() => buttons[0].props.onClick());
  assert.deepEqual(changes, ["list"]);
  await flush(() =>
    toolbar.update(
      React.createElement(ItemToolbar, {
        archived: false,
        layout: "list",
        busy: true,
        onLayout() {},
      }),
    ),
  );
  assert.ok(
    toolbar.root.findAllByType("button").every((b) => b.props.disabled),
  );
});

test("legacy Icon export remains stable; named Heroicons keep contextual 18px decorative currentColor SVGs", () => {
  assert.equal(LegacyIcon, Icon);
  for (const name of [
    "folder",
    "all",
    "archive",
    "plus",
    "refresh",
    "list",
    "grid",
    "back",
    "menu",
    "text",
    "link",
    "media",
    "edit",
    "more",
  ]) {
    const markup = renderToStaticMarkup(React.createElement(Icon, { name }));
    assert.match(markup, /aria-hidden="true"/);
    assert.match(markup, /width="18" height="18"/);
    assert.match(markup, /stroke="currentColor"/);
    assert.doesNotMatch(markup, /<title/);
  }
});

test("route hook preserves parsing/legacy exports and push/replace mechanics without taking popstate guard ownership", async (t) => {
  const previous = globalThis.window;
  t.after(() => {
    globalThis.window = previous;
  });
  const location = new URL(
    "https://fixture.invalid/stash?folder=a%2Fb&archive=1&item=i%20x&offset=2.9",
  );
  const calls = [];
  const update = (kind) => (_, __, url) => {
    calls.push([kind, url]);
    location.href = new URL(url, location).href;
  };
  globalThis.window = {
    location,
    history: { pushState: update("push"), replaceState: update("replace") },
  };
  assert.equal(readRoute, hookReadRoute);
  assert.deepEqual(readRoute(), {
    folderId: "a/b",
    archived: true,
    selected: "i x",
    offset: 2,
  });
  for (const [input, expected] of [
    ["-4", 0],
    ["Infinity", 99999900],
    ["NaN", 0],
    ["999999999", 99999900],
  ]) {
    location.search = `?offset=${input}`;
    assert.equal(readRoute().offset, expected);
  }
  location.search = "";
  assert.equal(routeUrl(readRoute()), "/stash");
  let state;
  function Probe() {
    state = useWebRoute();
    return null;
  }
  await mount(t, React.createElement(Probe));
  const next = {
    folderId: "a/b",
    archived: true,
    selected: "i x",
    offset: 100,
  };
  await flush(() => state.writeRoute(next));
  await flush(() => state.writeRoute(next));
  assert.equal(calls.length, 1, "same URL does not add history");
  assert.equal(calls[0][0], "push");
  assert.equal(
    calls[0][1],
    "/stash?folder=a%2Fb&archive=1&item=i+x&offset=100",
  );
  await flush(() => state.writeRoute(next, true));
  assert.equal(calls.at(-1)[0], "replace");
  await flush(() => state.setRoute({ ...next, selected: "" }));
  assert.equal(
    calls.length,
    2,
    "App may apply guarded popstate without rewriting history",
  );
  assert.equal(state.route.selected, "");
});

for (const initial of ["grid", "unexpected", "throws"])
  test(`layout preference stays local and tolerates storage failures (${initial})`, async (t) => {
    const previous = globalThis.window,
      writes = [];
    t.after(() => {
      globalThis.window = previous;
    });
    globalThis.window = {
      localStorage: {
        getItem: (key) => {
          assert.equal(key, "stash.all.layout");
          if (initial === "throws") throw Error("Disabled");
          return initial;
        },
        setItem: (...args) => {
          writes.push(args);
          throw Error("Disabled");
        },
      },
    };
    let preference;
    function Probe() {
      preference = useLayoutPreference();
      return null;
    }
    await mount(t, React.createElement(Probe));
    assert.equal(preference[0], initial === "grid" ? "grid" : "list");
    await flush(() => preference[1]("grid"));
    assert.equal(preference[0], "grid");
    assert.deepEqual(writes, [["stash.all.layout", "grid"]]);
  });

test("folder navigation renders complete decorative saved text while retaining names, selection, archives and context controls", async t => {
  const folders = [
    { id: "custom", name: "Custom shelf", icon: "🧑🏽‍💻🏳️‍🌈", archived_at: null },
    { id: "html", name: "Safe shelf", icon: "<img src=x onerror=alert(1)>", archived_at: null },
    { id: "archived", name: "Old shelf", icon: "👨‍👩‍👧‍👦✉️", archived_at: 1 },
  ];
  const selections = [], menus = [];
  const props = { folders, selected: "custom", archived: false, onSelect: id => selections.push(id), onMenu: (...args) => menus.push(args) };
  const renderer = await mount(t, React.createElement(FolderNavigation, props));
  assert.deepEqual(renderer.root.findAllByProps({ className: "folder-emoji" }).map(n => n.children.join("")), folders.slice(0, 2).map(f => f.icon));
  await flush(() => renderer.update(React.createElement(FolderNavigation, { ...props, archived: true })));
  const icons = renderer.root.findAllByProps({ className: "folder-emoji" });
  assert.deepEqual(icons.map(n => n.children.join("")), folders.map(f => f.icon));
  assert.ok(icons.every(n => n.props["aria-hidden"] === "true"));
  assert.equal(renderer.root.findAllByType("img").length, 0);
  const buttons = renderer.root.findAllByType("button");
  assert.equal(buttons[0].findAllByType("svg").length, 1, "All items stays a Heroicon");
  for (const f of folders) {
    const link = buttons.find(b => b.props.title === f.name);
    assert.equal(link.props["aria-current"], f.id === "custom" ? "page" : undefined);
    assert.equal(link.findAllByType("svg").length, 0);
    assert.equal(link.findByProps({ className: "truncate" }).children.join(""), f.name);
    await flush(() => link.props.onClick());
    const control = buttons.find(b => b.props["aria-label"] === `Actions for ${f.name}`);
    assert.equal(control.props["aria-haspopup"], "menu");
    assert.equal(control.findAllByType("svg").length, 1);
    const trigger = { focus() {} };
    control.props.onClick({ currentTarget: trigger });
    assert.deepEqual(menus.at(-1), [f.id, trigger]);
    const row = renderer.root.findAllByProps({ className: "folder-row" }).find(r => r.findAllByType("button")[0] === link);
    let prevented = 0;
    row.props.onContextMenu({ preventDefault() { prevented++; }, currentTarget: { querySelector: () => trigger }, clientX: 12, clientY: 34 });
    assert.deepEqual(menus.at(-1), [f.id, trigger, { x: 12, y: 34 }]);
    for (const event of [{ key: "ContextMenu" }, { key: "F10", shiftKey: true }]) {
      row.props.onKeyDown({ ...event, preventDefault() { prevented++; }, target: trigger });
      assert.deepEqual(menus.at(-1), [f.id, trigger]);
    }
    assert.equal(prevented, 3);
  }
  assert.deepEqual(selections, folders.map(f => f.id));
  assert.equal(buttons.find(b => b.props.title === "Old shelf").findByProps({ className: "sr-only" }).children.join(""), " (archived)");
  const markup = renderToStaticMarkup(React.createElement(FolderNavigation, { ...props, archived: true }));
  assert.match(markup, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(markup, /<img/);
  await flush(() => renderer.update(React.createElement(FolderNavigation, { ...props, busy: true })));
  assert.ok(renderer.root.findAllByType("button").filter(b => b.props["aria-haspopup"] === "menu").every(b => b.props.disabled));
});
