import React from "react";
import type { WebFolder, WebItem } from "../src/contracts.js";

const paths = {
  folder: "M3 5h6l2 2h10v12H3z",
  all: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  archive: "M3 3h18v4H3zm2 4v14h14V7M9 11h6",
  plus: "M12 5v14M5 12h14",
  refresh: "M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0114-2l1 6M4 12l1 6a8 8 0 0014-2",
  list: "M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1",
  grid: "M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z",
  back: "M15 5l-7 7 7 7",
  menu: "M3 6h18M3 12h18M3 18h18",
  text: "M5 4h14v16H5zM8 8h8M8 12h8M8 16h5",
  link: "M10 14l4-4M8 16l-2 2a4 4 0 01-5-5l5-5a4 4 0 015 0M16 8l2-2a4 4 0 015 5l-5 5a4 4 0 01-5 0",
  media: "M3 3h18v18H3zM3 17l6-6 5 5 3-3 4 4",
  edit: "M4 16L16 4l4 4L8 20H4z",
} as const;
export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}
export function FolderNavigation({
  folders,
  selected,
  archived,
  onSelect,
}: {
  folders: WebFolder[];
  selected: string;
  archived: boolean;
  onSelect: (id: string) => void;
}) {
  const group = (isArchived: boolean) =>
    folders
      .filter((f) => (f.archived_at !== null) === isArchived)
      .map((f) => (
        <button
          className="folder-link"
          key={f.id}
          aria-current={selected === f.id ? "page" : undefined}
          onClick={() => onSelect(f.id)}
          title={f.name}
        >
          <Icon name="folder" />
          <span className="truncate">{f.name}</span>
        </button>
      ));
  return (
    <nav aria-label="Folders" className="folder-nav">
      <button
        className="folder-link"
        aria-current={!selected ? "page" : undefined}
        onClick={() => onSelect("")}
      >
        <Icon name="all" />
        All items
      </button>
      <p className="nav-label">Folders</p>
      {group(false)}
      {archived && folders.some((f) => f.archived_at !== null) && (
        <>
          <p className="nav-label">Archived folders</p>
          {group(true)}
        </>
      )}
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
      <button
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
      </button>
    </li>
  );
}
