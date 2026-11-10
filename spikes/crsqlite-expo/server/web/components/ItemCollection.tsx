import React, { useEffect, useRef } from "react";
import type { WebItem } from "../../src/contracts.js";
import type { Route } from "../hooks/useWebRoute.js";
import { Icon } from "./Icon.js";
import { ItemCard } from "../components.js";
import { ItemToolbar } from "./ItemToolbar.js";
import { Button } from "./controls.js";

export function ItemCollection({
  folderName,
  folderId,
  archived,
  selected,
  offset,
  items,
  loadedPage,
  hasMore,
  loading,
  busy,
  layout,
  onLayout,
  onUnarchive,
  onNew,
  onSelect,
  onPage,
}: {
  folderName?: string;
  folderId: string;
  archived: boolean;
  selected: string;
  offset: number;
  items: WebItem[];
  loadedPage: Pick<Route, "folderId" | "archived" | "offset"> | null;
  hasMore: boolean;
  loading: boolean;
  busy: boolean;
  layout: "list" | "grid";
  onLayout: (layout: "list" | "grid") => void;
  onUnarchive: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onPage: (offset: number) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 0; }, [folderId, archived, offset]);
  return (
    <main className="collection" aria-label="Items" aria-busy={loading}>
      <ItemToolbar
        folderName={folderName}
        archived={archived}
        layout={layout}
        busy={busy}
        onLayout={onLayout}
      />
      <div className="collection-scroll" ref={scroller}>
        {!loading && !items.length && (
          <div className="empty">
            <Icon name={archived ? "archive" : "folder"} />
            <h3>{archived ? "Nothing archived here" : "No items yet"}</h3>
            <p>
              {archived
                ? "Archived items will appear here."
                : "Add a text or link to start this collection."}
            </p>
            <Button
              disabled={busy}
              onClick={() => (archived ? onUnarchive() : onNew())}
            >
              {archived ? "Back to collection" : "New item"}
            </Button>
          </div>
        )}
        <ul
          className={`items ${layout === "grid" ? "grid grid-cols-2 gap-2" : "flex flex-col"}`}

        >
          {items.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              selected={selected === item.id}
              onSelect={() => onSelect(item.id)}
              onKeyDown={(e) => {
                if (
                  ["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft"].includes(
                    e.key,
                  )
                ) {
                  e.preventDefault();
                  const buttons = [
                    ...e.currentTarget
                      .closest("ul")!
                      .querySelectorAll<HTMLButtonElement>("button"),
                  ];
                  const delta =
                    e.key === "ArrowUp"
                      ? layout === "grid"
                        ? -2
                        : -1
                      : e.key === "ArrowDown"
                        ? layout === "grid"
                          ? 2
                          : 1
                        : e.key === "ArrowLeft"
                          ? -1
                          : 1;
                  buttons[
                    Math.max(
                      0,
                      Math.min(
                        buttons.length - 1,
                        buttons.indexOf(e.currentTarget) + delta,
                      ),
                    )
                  ]?.focus();
                }
              }}
            />
          ))}
        </ul>
        {(offset > 0 || hasMore) && (
          <nav aria-label="Item pages" className="actions mt-6">
            {!loading &&
              items.length > 0 &&
              loadedPage?.folderId === folderId &&
              loadedPage.archived === archived &&
              loadedPage.offset === offset && (
                <span className="text-muted text-sm">
                  Items {offset + 1}–{offset + items.length}
                </span>
              )}
            <Button
              disabled={!offset || loading || busy}
              onClick={() => onPage(Math.max(0, offset - 100))}
            >
              Previous
            </Button>
            <Button
              disabled={!hasMore || loading || busy}
              onClick={() => onPage(offset + 100)}
            >
              Next
            </Button>
          </nav>
        )}
      </div>
    </main>
  );
}
