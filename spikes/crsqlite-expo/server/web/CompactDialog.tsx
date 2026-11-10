import React, { useEffect } from "react";
import { Dialog } from "@base-ui/react/dialog";

/** Base UI owns modality, outside/Escape dismissal and the keyboard focus trap. */
export function CompactDialog({ title, id, busy = false, returnFocus, onCancel, children }: {
  title: string;
  id: string;
  busy?: boolean;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    // Keep the old native-dialog guarantee even for programmatic focus attempts.
    // Base UI owns the focus loop and aria-hidden; the portal is outside #root.
    const background = document.getElementById?.("root");
    const previousInert = background?.inert ?? false;
    if (background) background.inert = true;
    return () => {
      if (background) background.inert = previousInert;
      // Creation may also hide the mobile drawer. Resolve a visible target after
      // the closing commit, rather than restoring focus to its hidden trigger.
      window.setTimeout?.(() => {
        const visible = (node: HTMLElement | null): node is HTMLElement =>
          !!node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
        const target = [returnFocus, ...document.querySelectorAll<HTMLElement>(".sidebar-toggle, .folder-link")].find(visible);
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  return <Dialog.Root open onOpenChange={(open, details) => {
    if (!open) {
      details.cancel(); // App retains ownership of busy/discard guards and unmounting.
      if (!busy) onCancel();
    }
  }}>
    <Dialog.Portal>
      <Dialog.Backdrop className="dialog-backdrop" />
      <Dialog.Popup className="folder-dialog" aria-labelledby={id} aria-busy={busy} aria-modal="true"
        initialFocus={() => document.querySelector<HTMLElement>(".folder-dialog [autofocus], .folder-dialog input, .folder-dialog button")}
        finalFocus={false} onKeyDown={(e) => e.stopPropagation()}>
        <header className="dialog-header"><Dialog.Title render={<h2 />} id={id}>{title}</Dialog.Title></header>
        <div className="dialog-body">{children}</div>
      </Dialog.Popup>
    </Dialog.Portal>
  </Dialog.Root>;
}
