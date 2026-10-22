import React from "react";
import { Icon } from "./Icon.js";
import { IconButton, SegmentedControl } from "./controls.js";

export function ItemToolbar({
  folderName,
  archived,
  layout,
  busy,
  onLayout,
}: {
  folderName?: string;
  archived: boolean;
  layout: "list" | "grid";
  busy: boolean;
  onLayout: (layout: "list" | "grid") => void;
}) {
  const heading = folderName || (archived ? "Archived items" : "All items");
  return (
    <div className="collection-heading">
      <h2 title={heading}>
        {heading}
        {archived && <span className="sr-only"> · Archived items only</span>}
      </h2>
      <SegmentedControl className="ml-auto" aria-label="Collection layout">
        <IconButton
          title="List layout"
          aria-label="List layout"
          aria-pressed={layout === "list"}
          disabled={busy}
          onClick={() => onLayout("list")}
        >
          <Icon name="list" />
        </IconButton>
        <IconButton
          title="Grid layout"
          aria-label="Grid layout"
          aria-pressed={layout === "grid"}
          disabled={busy}
          onClick={() => onLayout("grid")}
        >
          <Icon name="grid" />
        </IconButton>
      </SegmentedControl>
    </div>
  );
}
