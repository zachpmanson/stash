import React from "react";
import type { WebFolder, WebItem } from "../../src/contracts.js";
import { ItemEditor, ItemReader } from "../items.js";
import { Icon } from "./Icon.js";
import { Button } from "./controls.js";

/** Persistent and unkeyed: retain the editor's ancestor types and child slot. */
export function ReaderPane({
  readerRef,
  readerOpen,
  selected,
  editor,
  detail,
  busy,
  loading,
  folders,
  membershipCount,
  onClose,
  onDirty,
  onCancel,
  onSave,
  onEdit,
  onArchive,
  onMembership,
}: {
  readerRef: React.Ref<HTMLElement>;
  readerOpen: boolean;
  selected: string;
  editor: "new" | "edit" | null;
  detail: WebItem | null;
  busy: boolean;
  loading: boolean;
  folders: WebFolder[];
  membershipCount: number;
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  onCancel: () => void;
  onSave: React.ComponentProps<typeof ItemEditor>["onSave"];
  onEdit: () => void;
  onArchive: () => void;
  onMembership: (id: string, present: boolean) => void;
}) {
  return (
    <section
      className="reader"
      aria-label="Selected item"
      tabIndex={-1}
      ref={readerRef}
    >
      {readerOpen && (
        <Button className="back-button mb-3" disabled={busy} onClick={onClose}>
          <Icon name="back" />
          Back to collection
        </Button>
      )}
      {editor ? (
        <ItemEditor
          key={editor === "new" ? "new" : selected}
          item={editor === "edit" ? detail : null}
          busy={busy}
          onDirty={onDirty}
          onCancel={onCancel}
          onSave={onSave}
        />
      ) : detail ? (
        <div className="reader-content">
          <p className="eyebrow">
            {detail.type === "url"
              ? "Saved link"
              : detail.type === "text"
                ? "Note"
                : "On your device"}
          </p>
          <ItemReader
            item={detail}
            actions={
              !detail.mediaUnavailable && (
                <div className="actions my-3">
                  <Button
                    aria-label="Edit item"
                    disabled={busy}
                    onClick={onEdit}
                  >
                    Edit item
                  </Button>
                  <Button disabled={busy} onClick={onArchive}>
                    {detail.archived_at === null
                      ? "Archive item"
                      : "Unarchive item"}
                  </Button>
                </div>
              )
            }
          />
          {!detail.mediaUnavailable && (
            <>
              <details className="organise">
                <summary>
                  <span className="sr-only">Folder membership: </span>
                  Organise ·{" "}
                  {membershipCount === 0
                    ? "No folders"
                    : `${membershipCount} ${membershipCount === 1 ? "folder" : "folders"}`}
                </summary>
                <fieldset disabled={busy}>
                  <legend className="sr-only">Folder membership</legend>
                  {folders.map((f) => (
                    <label className="check" key={f.id}>
                      <input
                        type="checkbox"
                        checked={detail.folderIds.includes(f.id)}
                        onChange={(e) => onMembership(f.id, e.target.checked)}
                      />
                      {f.name}
                      {f.archived_at !== null ? " (archived)" : ""}
                    </label>
                  ))}
                  {!folders.length && (
                    <p>Create a folder to organize this item.</p>
                  )}
                </fieldset>
              </details>
            </>
          )}
        </div>
      ) : (
        <div className="reader-placeholder">
          <Icon name="text" />
          <h2>{selected && loading ? "Loading item…" : "No item selected"}</h2>
          <p>Choose an item to read it.</p>
        </div>
      )}
    </section>
  );
}
