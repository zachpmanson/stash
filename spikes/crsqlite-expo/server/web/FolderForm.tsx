import { Button } from "./components/controls.js";
import React, { useState } from "react";
import { Spinner } from "./Spinner.js";

/** Freeze the observed name just like the item editor: refresh is not consent to overwrite. */
export function FolderForm({
  initialName,
  busy,
  onSave,
  onDirty,
  onCancel,
}: {
  initialName: string | null;
  busy: boolean;
  onSave: (name: string | null) => void;
  onDirty: (dirty: boolean) => void;
  onCancel: () => void;
}) {
  const [baseline] = useState(initialName);
  return (
    <form
      className="dialog-form"
      onChange={(event) =>
        onDirty(
          new FormData(event.currentTarget).get("name") !== (baseline ?? ""),
        )
      }
      onSubmit={(event) => {
        event.preventDefault();
        const name = String(
          new FormData(event.currentTarget).get("name") ?? "",
        ).trim();
        if (!busy && name) onSave(name === baseline ? null : name);
      }}
    >
      <label>
        Folder name
        <input
          autoFocus
          disabled={busy}
          required
          name="name"
          maxLength={200}
          defaultValue={baseline ?? ""}
        />
      </label>
      <div className="dialog-actions">
        <Button type="submit" className="primary" disabled={busy} aria-live="polite">
          {busy && <Spinner />}
          {busy
            ? baseline === null
              ? "Creating…"
              : "Saving…"
            : baseline === null
              ? "Create"
              : "Rename folder"}
        </Button>
        <Button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
