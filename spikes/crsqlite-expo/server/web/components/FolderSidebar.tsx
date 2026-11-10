import React from "react";
import { Field } from "@base-ui/react/field";
import { Select } from "@base-ui/react/select";
import { IconChevronDown, IconCheck } from "@tabler/icons-react";
import { FolderNavigation } from "../components.js";
import { Icon } from "./Icon.js";
import { Button, IconButton } from "./controls.js";

const archiveViews = { active: "Active items", archived: "Archived items" };

type NavigationProps = React.ComponentProps<typeof FolderNavigation>;
export function FolderSidebar({
  sidebarOpen,
  folders,
  selected,
  archived,
  busy,
  menuId,
  onClose,
  onMenu,
  onSelect,
  onNew,
  onArchive,
}: {
  sidebarOpen: boolean;
  folders: NavigationProps["folders"];
  selected: string;
  archived: boolean;
  busy: boolean;
  menuId?: string;
  onClose: () => void;
  onMenu: NavigationProps["onMenu"];
  onSelect: NavigationProps["onSelect"];
  onNew: (trigger: HTMLButtonElement) => void;
  onArchive: (archived: boolean) => void;
}) {
  return (
    <aside
      className={`sidebar ${sidebarOpen ? "is-open" : ""}`}
      aria-label="Library filters"
    >
      <div className="sidebar-heading">
        <IconButton
          className="sidebar-toggle"
          aria-label="Close folders"
          onClick={onClose}
        >
          <Icon name="back" />
        </IconButton>
      </div>
      <FolderNavigation
        folders={folders}
        selected={selected}
        archived={archived}
        busy={busy}
        menuId={menuId}
        onMenu={onMenu}
        onSelect={onSelect}
      />
      {!archived && (
        <Button className="new-folder" disabled={busy} onClick={(event) => onNew(event.currentTarget)}>
          <Icon name="plus" />
          New folder
        </Button>
      )}
      <footer className="sidebar-footer">
        <Field.Root disabled={busy}>
          <Field.Label>Show items</Field.Label>
          <Select.Root items={archiveViews} value={archived ? "archived" : "active"} disabled={busy}
            onValueChange={value => { if (value) onArchive(value === "archived"); }}>
            <Select.Trigger className="archive-select"><Select.Value /><Select.Icon><IconChevronDown size={14} aria-hidden="true" /></Select.Icon></Select.Trigger>
            <Select.Portal>
              <Select.Positioner alignItemWithTrigger={false} side="top" sideOffset={4} collisionPadding={8} className="type-select-positioner">
                <Select.Popup className="type-select-popup">
                  <Select.List>
                    {Object.entries(archiveViews).map(([value, label]) => <Select.Item key={value} value={value} className="type-select-item">
                      <Select.ItemText>{label}</Select.ItemText><Select.ItemIndicator><IconCheck size={14} aria-hidden="true" /></Select.ItemIndicator>
                    </Select.Item>)}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </Field.Root>
      </footer>
    </aside>
  );
}
