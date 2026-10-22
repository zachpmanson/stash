import React from "react";
import { FolderNavigation } from "../components.js";
import { FolderForm } from "../FolderForm.js";
import { Icon } from "./Icon.js";
import { Button, IconButton } from "./controls.js";

type NavigationProps = React.ComponentProps<typeof FolderNavigation>;
export function FolderSidebar({
  sidebarOpen,
  folders,
  selected,
  archived,
  busy,
  creating,
  onClose,
  onMenu,
  onSelect,
  onToggleNew,
  formProps,
}: {
  sidebarOpen: boolean;
  folders: NavigationProps["folders"];
  selected: string;
  archived: boolean;
  busy: boolean;
  creating: boolean;
  onClose: () => void;
  onMenu: NavigationProps["onMenu"];
  onSelect: NavigationProps["onSelect"];
  onToggleNew: () => void;
  formProps: Pick<
    React.ComponentProps<typeof FolderForm>,
    "onDirty" | "onCancel" | "onSave"
  >;
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
        onMenu={onMenu}
        onSelect={onSelect}
      />
      {!archived && (
        <Button className="new-folder" disabled={busy} onClick={onToggleNew}>
          <Icon name="plus" />
          New folder
        </Button>
      )}
      {creating && (
        <FolderForm key="new" initialName={null} busy={busy} {...formProps} />
      )}
    </aside>
  );
}
