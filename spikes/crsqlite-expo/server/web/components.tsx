import React from "react";
import type { WebFolder, WebItem } from "../src/contracts.js";

import { Icon } from "./components/Icon.js";
import { Button, IconButton } from "./components/controls.js";
export { Icon } from "./components/Icon.js";
export function FolderNavigation({
  folders,
  selected,
  archived,
  onSelect,
  onMenu,
  busy = false,
}: {
  folders: WebFolder[];
  selected: string;
  archived: boolean;
  onSelect: (id: string) => void;
  onMenu: (id: string, trigger: HTMLElement, point?: { x: number; y: number }) => void;
  busy?: boolean;
}) {
  const group = (isArchived: boolean) =>
    folders
      .filter((f) => (f.archived_at !== null) === isArchived)
      .map((f) => (
        <div className="folder-row" key={f.id}
          onContextMenu={(e) => {
            e.preventDefault();
            onMenu(f.id, e.currentTarget.querySelector("button")!, { x: e.clientX, y: e.clientY });
          }}
          onKeyDown={(e) => {
            if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
              e.preventDefault();
              onMenu(f.id, e.target as HTMLElement);
            }
          }}>
          <Button className="folder-link" aria-current={selected === f.id ? "page" : undefined}
            onClick={() => onSelect(f.id)} title={f.name}>
            <Icon name="folder" />
            <span className="truncate">{f.name}</span>
            {f.archived_at !== null && <span className="sr-only"> (archived)</span>}
          </Button>
          <IconButton className="folder-menu-toggle" aria-label={`Actions for ${f.name}`} aria-haspopup="menu"
            disabled={busy} onClick={(e) => onMenu(f.id, e.currentTarget)}>
            <Icon name="more" />
          </IconButton>
        </div>
      ));
  return (
    <nav aria-label="Folders" className="folder-nav">
      <Button
        className="folder-link"
        aria-current={!selected ? "page" : undefined}
        onClick={() => onSelect("")}
      >
        <Icon name="all" />
        All items
      </Button>
      {group(false)}
      {archived && group(true)}
    </nav>
  );
}
export function ItemCard({
  item,
  selected,
  onSelect,
  onKeyDown,
}: {
  item: WebItem;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: React.KeyboardEventHandler<HTMLButtonElement>;
}) {
  const title =
    item.title ||
    item.excerpt ||
    item.domain ||
    (item.type === "text"
      ? "Untitled text"
      : item.type === "url"
        ? "Link"
        : "Media unavailable");
  return (
    <li className="min-w-0">
      <Button
        className="item-card"
        data-item-id={item.id}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className="card-icon">
          <Icon
            name={
              item.mediaUnavailable
                ? "media"
                : item.type === "url"
                  ? "link"
                  : "text"
            }
          />
        </span>
        <span className="min-w-0 flex-1">
          <strong className="card-title" title={title}>
            {title}
          </strong>
          <small>
            <span className="card-kind">
              {item.mediaUnavailable
                ? "Media · available on device"
                : item.domain || (item.type === "text" ? "Note" : "Link")}
            </span>
            {item.title && item.excerpt && (
              <span className="card-excerpt">{item.excerpt}</span>
            )}
          </small>
        </span>
      </Button>
    </li>
  );
}
