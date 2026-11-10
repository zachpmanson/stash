import { mock } from "node:test";
import React from "react";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

// react-test-renderer has no DOM/portals. Inline portals and disable DOM scroll
// locking for App state/identity tests; retain real controls and popup logic.
// The unmocked bundle's focus/dismissal/positioning is covered in browser-smoke.
if (/\/(desktop-ui|folder-feed-ui|web-components|web-ui|web-ui-regression|link-editor)\.test\.mjs$/.test(process.argv[1] ?? "")) {
  const requireBase = createRequire(import.meta.resolve("@base-ui/react/dialog"));
  const scrollLock = requireBase.resolve("@base-ui/utils/useScrollLock").replace(/\.js$/, ".mjs");
  mock.module(pathToFileURL(scrollLock).href, { exports: { useScrollLock() {} } });
  globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = clearTimeout;
  globalThis.Element ??= class Element {};
  globalThis.HTMLElement ??= class HTMLElement extends Element {};
  globalThis.Node ??= class Node {};
  const noop = () => {};
  let windowValue = { Element, HTMLElement, Node, addEventListener: noop, removeEventListener: noop };
  Object.defineProperty(globalThis, "window", { configurable: true, get: () => windowValue,
    set: value => { windowValue = value && { Element, HTMLElement, Node, addEventListener: noop, removeEventListener: noop, ...value }; } });
  let documentValue = { addEventListener: noop, removeEventListener: noop };
  Object.defineProperty(globalThis, "document", { configurable: true, get: () => documentValue,
    set: value => { documentValue = value && { addEventListener: noop, removeEventListener: noop, ...value }; } });
  for (const [path, name] of [["dialog", "Dialog"], ["menu", "Menu"]]) {
    const url = import.meta.resolve(`@base-ui/react/${path}`);
    const module = await import(url);
    const context = await import(new URL(`portal/${name}PortalContext.mjs`, url));
    mock.module(`@base-ui/react/${path}`, {
      exports: { ...module, [name]: { ...module[name], Portal: ({ children }) =>
        React.createElement(context[`${name}PortalContext`].Provider, { value: false }, children) } },
    });
  }
}

export function clickEvent(currentTarget = { focus() {} }) {
  return { nativeEvent: {}, currentTarget, target: currentTarget, preventDefault() {}, stopPropagation() {} };
}
