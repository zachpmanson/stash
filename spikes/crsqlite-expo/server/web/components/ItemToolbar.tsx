import React from "react";
import { Icon } from "./Icon.js";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { Toggle } from "@base-ui/react/toggle";

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
      <ToggleGroup className="layout-toggle ml-auto" aria-label="Collection layout"
        value={[layout]} disabled={busy} onValueChange={(values) => {
          const next = values[0];
          if (next === "list" || next === "grid") onLayout(next);
        }}>
        <Toggle
          title="List layout"
          aria-label="List layout"
          value="list"
        >
          <Icon name="list" />
        </Toggle>
        <Toggle
          title="Grid layout"
          aria-label="Grid layout"
          value="grid"
        >
          <Icon name="grid" />
        </Toggle>
      </ToggleGroup>
    </div>
  );
}
