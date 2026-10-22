import React, { useLayoutEffect, useRef, useState } from "react";
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
  const [position, setPosition] = useState({ left: target.x, top: target.y });
  useLayoutEffect(() => {
    const node = menu.current;
    if (!node) return;
    const fit = () => {
      const box = node.getBoundingClientRect();
      setPosition({ left: Math.max(8, Math.min(target.x, window.innerWidth - box.width - 8)),
        top: Math.max(8, Math.min(target.y, window.innerHeight - box.height - 8)) });
    };
    fit();
    node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => { if (!node.contains(event.target as Node)) onClose(); };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", onClose);
      if (node.contains(document.activeElement)) {
        const fallback = target.trigger.isConnected ? target.trigger : document.querySelector<HTMLElement>(".folder-link");
        fallback?.focus({ preventScroll: true });
      }
    };
  }, [target]);
  return <div ref={menu} role="menu" aria-label={`Actions for ${folder.name}`} className="folder-menu" style={position}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (["Escape", "Tab"].includes(e.key)) { e.preventDefault(); onClose(); }
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
        e.preventDefault();
        const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 :
          (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
    <button role="menuitem" disabled={busy} onClick={onRename}>Rename</button>
    <button role="menuitem" disabled={busy} onClick={onArchive}>
      {folder.archived_at === null ? "Archive folder" : "Unarchive folder"}
    </button>
    <button role="menuitem" disabled={busy || folder.archived_at !== null} onClick={onFeed}>Atom feed</button>
  </div>;
}
