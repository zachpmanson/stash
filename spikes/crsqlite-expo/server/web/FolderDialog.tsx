import React from "react";
import { CompactDialog } from "./CompactDialog.js";
import { FolderForm } from "./FolderForm.js";

export function FolderDialog({ name, busy, error, returnFocus, onCancel, onDirty, onSave }: {
  name: string;
  busy: boolean;
  error: string;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  onDirty: (dirty: boolean) => void;
  onSave: (name: string | null) => void;
}) {
  return <CompactDialog title="Rename folder" id="rename-folder-title" busy={busy} returnFocus={returnFocus} onCancel={onCancel}>
    {error && <p role="alert" className="mt-3">{error}</p>}
    <FolderForm initialName={name} busy={busy} onCancel={onCancel} onDirty={onDirty} onSave={onSave} />
  </CompactDialog>;
}
