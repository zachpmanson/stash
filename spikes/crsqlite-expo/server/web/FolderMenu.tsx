import React, { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Menu } from "@base-ui/react/menu";
import type { WebFolder } from "../src/contracts.js";

export type FolderMenuTarget = { id: string; x: number; y: number; trigger: HTMLElement };
export function FolderMenu({ target, folder, busy, onClose, onRename, onArchive, onFeed }: {
  target: FolderMenuTarget;
  folder: WebFolder;
  busy: boolean;
  onClose: () => void;
  onRename: () => void;
  onArchive: () => void;
  onFeed: () => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  const outsideClose = useRef(false);
  useLayoutEffect(() => {
    return () => {
      const node = menu.current;
      // Capture ownership before React removes the portal. Resolve a surviving
      // target after the commit (the folder trigger may be removed in it too).
      if (!node?.contains(document.activeElement) || outsideClose.current) return;
      window.setTimeout?.(() => {
        if (node.isConnected || document.querySelector('[role="dialog"]') ||
            (document.activeElement !== document.body && !node.contains(document.activeElement))) return;
        const visible = (element: HTMLElement | null): element is HTMLElement =>
          !!element?.isConnected && element.getClientRects().length > 0 &&
          getComputedStyle(element).visibility !== "hidden" && !element.matches(":disabled");
        const fallback = visible(target.trigger) ? target.trigger :
          [...document.querySelectorAll<HTMLElement>(".folder-link")].find(visible);
        // The surviving control may be above the sidebar's scroll viewport.
        // Native focus scrolling reveals it without moving unrelated panes.
        fallback?.focus();
      }, 0);
    };
  }, [target]);
  const anchor = useMemo(() => ({
    getBoundingClientRect: () => ({ x: target.x, y: target.y, left: target.x, right: target.x,
      top: target.y, bottom: target.y, width: 0, height: 0, toJSON() {} }),
  }), [target]);
  useEffect(() => {
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [target]);
  return <Menu.Root open modal={false} onOpenChangeComplete={(open) => {
    if (open) menu.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }} onOpenChange={(open, details) => {
    if (!open) {
      outsideClose.current = details.reason === "outside-press" || details.reason === "focus-out";
      onClose();
    }
  }}>
    <Menu.Portal>
      <Menu.Positioner anchor={anchor} positionMethod="fixed" align="start" collisionPadding={8} sticky collisionAvoidance={{ side: "shift", align: "shift" }} className="folder-menu-positioner">
        <Menu.Popup ref={menu} id="folder-actions-menu" aria-label={`Actions for ${folder.name}`} className="folder-menu"
          finalFocus={false} onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Tab") { e.preventDefault(); onClose(); }
          }}>
          {/* App closes only after its discard guard accepts the action. */}
          <Menu.Item render={<button type="button" />} nativeButton closeOnClick={false} disabled={busy} onClick={onRename}>Rename</Menu.Item>
          <Menu.Item render={<button type="button" />} nativeButton closeOnClick={false} disabled={busy} onClick={onArchive}>
            {folder.archived_at === null ? "Archive folder" : "Unarchive folder"}
          </Menu.Item>
          <Menu.Item render={<button type="button" />} nativeButton closeOnClick={false} disabled={busy || folder.archived_at !== null} onClick={onFeed}>Atom feed</Menu.Item>
        </Menu.Popup>
      </Menu.Positioner>
    </Menu.Portal>
  </Menu.Root>;
}
