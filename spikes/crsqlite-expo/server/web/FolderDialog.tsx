import React from "react";
import { CompactDialog } from "./CompactDialog.js";
import { FolderForm } from "./FolderForm.js";

export function FolderDialog({ name, busy, error, returnFocus, onCancel, onDirty, onSave }: {
  name: string | null;
  busy: boolean;
  error: string;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  onSave: (name: string | null) => void;
}) {
  return <CompactDialog title={name === null ? "New folder" : "Rename folder"} id={name === null ? "new-folder-title" : "rename-folder-title"} busy={busy} returnFocus={returnFocus} onCancel={onCancel}>
    {error && <p role="alert">{error}</p>}
    <FolderForm initialName={name} busy={busy} onCancel={onCancel} onDirty={onDirty} onSave={onSave} />
  </CompactDialog>;
}
