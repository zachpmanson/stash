import type { FlashListRef } from "@shopify/flash-list";
import type { ReaderBlock, ReaderDocument } from "./readerChunks";
import type { ReaderBookmark } from "./readerBookmark";

type List = Pick<FlashListRef<ReaderBlock>, "scrollToIndex" | "scrollToOffset" | "getLayout" |
  "getFirstVisibleIndex" | "getAbsoluteLastScrollOffset" | "getFirstItemOffset">;

/** Ref-only navigation. FlashList owns dynamic layout/acquisition; bookmarks use
 * measured row geometry in document coordinates, never estimated prefix sizes. */
export class ReaderNavigation {
  private pending: { index: number; offset: number; acquired: boolean } | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  private loaded = false;
  private started = false;
  active = true;
  constructor(
    private document: ReaderDocument,
    private list: () => List | null,
    private onAcquisitionFailed: () => void,
  ) {}

  onLoad() {
    if (!this.active) return;
    this.loaded = true;
    this.acquire();
  }

  capture(): ReaderBookmark | null {
    const list = this.active && this.loaded ? this.list() : null;
    if (!list) return null;
    const index = list.getFirstVisibleIndex();
    const cell = list.getLayout(index);
    const block = this.document.blocks[index];
    if (!block || !cell?.isHeightMeasured || cell.height <= 0) return null;
    const y = list.getAbsoluteLastScrollOffset() - list.getFirstItemOffset();
    if (!Number.isFinite(y) || !Number.isFinite(cell.y) || !Number.isFinite(cell.height)) return null;
    // The header is visible: anchor the first document block, not the header.
    if (y < cell.y && index !== 0) return null;
    if (y >= cell.y + cell.height) return null;
    return { version: 1, kind: "article", revision: this.document.revision, blockKey: block.key,
      offset: Math.max(0, Math.min(1, (y - cell.y) / cell.height)) };
  }

  restore(bookmark: ReaderBookmark): boolean {
    this.cancel();
    if (!this.active || bookmark.kind !== "article" || bookmark.revision !== this.document.revision ||
      !Number.isFinite(bookmark.offset) || bookmark.offset < 0 || bookmark.offset > 1) return false;
    const index = this.document.blocks.findIndex(block => block.key === bookmark.blockKey);
    if (index < 0) return false;
    this.pending = { index, offset: bookmark.offset, acquired: false };
    this.expiry = setTimeout(() => this.fail(), 4000);
    this.acquire();
    return true;
  }

  private acquire() {
    const pending = this.pending;
    const list = this.list();
    if (!this.active || !this.loaded || !pending || !list || this.started) return;
    this.started = true;
    // The engine measures a bounded window around the destination. Do not align
    // against its provisional prefix layouts while this operation is in flight.
    try {
      void list.scrollToIndex({ index: pending.index, animated: false }).then(() => {
        if (!this.active || this.pending !== pending) return;
        pending.acquired = true;
        this.align();
      }, () => { if (this.pending === pending) this.fail(); });
    } catch {
      if (this.pending === pending) this.fail();
    }
  }

  align() {
    const pending = this.pending;
    if (!this.active || !pending?.acquired) return;
    const list = this.list();
    const cell = list?.getLayout(pending.index);
    if (!list || !cell?.isHeightMeasured || !Number.isFinite(cell.y) ||
      !Number.isFinite(cell.height) || cell.height <= 0) return;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    // Layout y is relative to the data container, NOT the scroll view. Add the
    // actual header/padding offset exactly once. Keep following late images
    // until a gesture, new restore, geometry change or unmount cancels us.
    list.scrollToOffset({ offset: list.getFirstItemOffset() + cell.y + cell.height * pending.offset,
      animated: false, skipFirstItemOffset: true });
  }

  private fail() {
    if (!this.active || !this.pending) return;
    this.cancel();
    this.onAcquisitionFailed();
  }

  cancel() {
    this.pending = null;
    this.started = false;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
  }

  dispose() { this.cancel(); this.active = false; }
}
