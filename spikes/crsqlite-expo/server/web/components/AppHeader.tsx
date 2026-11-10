import React from "react";
import { Icon } from "./Icon.js";
import { IconButton, TooltipIconButton } from "./controls.js";
import { Spinner } from "../Spinner.js";

export function AppHeader({
  sidebarOpen,
  folderButton,
  archived,
  busy,
  loading,
  onToggleSidebar,
  onRefresh,
  onNew,
}: {
  sidebarOpen: boolean;
  folderButton: React.Ref<HTMLButtonElement>;
  archived: boolean;
  busy: boolean;
  loading: boolean;
  onToggleSidebar: () => void;
  onRefresh: () => void;
  onNew: () => void;
}) {
  return (
    <header className="app-header flex items-center gap-3 px-3 md:px-4">
      <IconButton
        className="sidebar-toggle"
        aria-label="Open folders"
        aria-expanded={sidebarOpen}
        onClick={onToggleSidebar}
        ref={folderButton}
      >
        <Icon name="menu" />
      </IconButton>
      <h1 className="text-xl font-semibold tracking-tight">Stash</h1>
      <div className="ml-auto flex items-center gap-2">
        <TooltipIconButton
          aria-label="Refresh"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          <Spinner active={loading} />
        </TooltipIconButton>
        {!archived && (
          <TooltipIconButton
            className="primary"
            aria-label="New item"
            disabled={busy}
            onClick={onNew}
          >
            <Icon name="plus" />
          </TooltipIconButton>
        )}
      </div>
    </header>
  );
}
