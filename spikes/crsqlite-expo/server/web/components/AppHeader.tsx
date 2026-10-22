import React from "react";
import { Icon } from "./Icon.js";
import { Button, IconButton } from "./controls.js";
import { Spinner } from "../Spinner.js";

export function AppHeader({
  sidebarOpen,
  folderButton,
  archived,
  busy,
  loading,
  onToggleSidebar,
  onToggleArchive,
  onRefresh,
  onNew,
}: {
  sidebarOpen: boolean;
  folderButton: React.Ref<HTMLButtonElement>;
  archived: boolean;
  busy: boolean;
  loading: boolean;
  onToggleSidebar: () => void;
  onToggleArchive: () => void;
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
        <IconButton
          aria-label="Archive"
          aria-pressed={archived}
          disabled={busy}
          onClick={onToggleArchive}
        >
          <Icon name="archive" />
          <span className="hidden min-[381px]:inline">Archive</span>
        </IconButton>
        <IconButton
          aria-label="Refresh"
          disabled={loading || busy}
          onClick={onRefresh}
        >
          <Spinner active={loading} />
          <span className="hidden sm:inline">Refresh</span>
        </IconButton>
        {!archived && (
          <Button
            className="primary"
            aria-label="New item"
            disabled={busy}
            onClick={onNew}
          >
            <Icon name="plus" />
            New item
          </Button>
        )}
      </div>
    </header>
  );
}
