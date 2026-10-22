import React, { useEffect, useRef } from "react";

/** Native inert background plus an explicit in-page keyboard focus loop. */
export function CompactDialog({ title, id, busy = false, returnFocus, onCancel, children }: {
  title: string;
  id: string;
  busy?: boolean;
  returnFocus: HTMLElement | null;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    return () => {
      // Restore after the closing commit: create may also hide the mobile drawer.
      window.setTimeout?.(() => {
        const visible = (node: HTMLElement | null): node is HTMLElement =>
          !!node?.isConnected && node.getClientRects().length > 0 && getComputedStyle(node).visibility !== "hidden";
        const target = [returnFocus, ...document.querySelectorAll<HTMLElement>(".sidebar-toggle, .folder-link")].find(visible);
        target?.focus({ preventScroll: true });
      }, 0);
    };
  }, []);
  return <dialog ref={dialog} className="folder-dialog" aria-labelledby={id} aria-busy={busy} tabIndex={-1}
    onKeyDown={(e) => {
      e.stopPropagation();
      if (e.key !== "Tab") return;
      const controls = [...e.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']")];
      const first = controls[0], last = controls.at(-1);
      if (!first) { e.preventDefault(); e.currentTarget.focus(); }
      else if (e.shiftKey && (document.activeElement === first || document.activeElement === e.currentTarget)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === e.currentTarget)) { e.preventDefault(); first.focus(); }
    }}
    onCancel={(e) => { e.preventDefault(); onCancel(); }}
    onClick={(e) => {
      if (e.target !== e.currentTarget) return;
      const box = e.currentTarget.getBoundingClientRect();
      if (e.clientX < box.left || e.clientX > box.right || e.clientY < box.top || e.clientY > box.bottom) onCancel();
    }}>
    <header className="dialog-header"><h2 id={id}>{title}</h2></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
