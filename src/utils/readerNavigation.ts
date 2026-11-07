import type { ReaderDocument } from "./readerChunks";
import type { ReaderBookmark } from "./readerBookmark";

type Cell = { y: number; height: number };
type List = {
  scrollToIndex: (options: { index: number; animated: boolean }) => void;
  scrollToOffset: (options: { offset: number; animated: boolean }) => void;
};

/** Ref-only list geometry/navigation. All coordinates come from native list cells,
 * never from renderItem's child (whose y is zero) or a fabricated getItemLayout. */
export class ReaderNavigation {
  private cells = new Map<number, Cell>();
  private pending: { index: number; offset: number } | null = null;
  private expiry: ReturnType<typeof setTimeout> | undefined;
  scrollY = 0;
  constructor(
    private document: ReaderDocument,
    private list: () => List | null,
    private seedWindow: (index: number) => void,
    private onAcquisitionFailed: () => void,
  ) {}

  measure(index: number, cell: Cell) {
    if (!Number.isFinite(cell.y) || !Number.isFinite(cell.height) || cell.height <= 0) return;
    this.cells.set(index, cell);
    if (this.pending?.index === index) this.align();
  }

  unmeasure(index: number) { this.cells.delete(index); }

  capture(): ReaderBookmark | null {
    let first: [number, Cell] | undefined;
    for (const entry of this.cells) {
      if (!first || entry[1].y < first[1].y) first = entry;
      const [index, cell] = entry;
      if (this.scrollY >= cell.y && this.scrollY < cell.y + cell.height) {
        return this.anchor(index, (this.scrollY - cell.y) / cell.height);
      }
    }
    // The header is visible: the document starts at its first block, not an estimated percentage.
    if (first?.[0] === 0 && this.scrollY < first[1].y) return this.anchor(0, 0);
    return null;
  }

  private anchor(index: number, offset: number): ReaderBookmark | null {
    const block = this.document.blocks[index];
    return block ? { version: 1, kind: "article", revision: this.document.revision, blockKey: block.key, offset: Math.max(0, Math.min(1, offset)) } : null;
  }

  restore(bookmark: ReaderBookmark): boolean {
    this.cancel();
    if (bookmark.kind !== "article" || bookmark.revision !== this.document.revision ||
      !Number.isFinite(bookmark.offset) || bookmark.offset < 0 || bookmark.offset > 1) return false;
    const index = this.document.blocks.findIndex(block => block.key === bookmark.blockKey);
    if (index < 0) return false;
    this.pending = { index, offset: bookmark.offset };
    this.expiry = setTimeout(() => {
      this.cancel();
      this.onAcquisitionFailed();
    }, 4000);
    if (this.cells.has(index)) {
      this.list()?.scrollToIndex({ index, animated: false });
      this.align();
    } else {
      // RN clamps an unmeasured tail spacer: average-offset jumps cannot acquire
      // a deep row on a fresh list. Seed only the bounded initial render window
      // at the target; discard geometry from the list being replaced.
      this.cells.clear();
      this.seedWindow(index);
    }
    return true;
  }

  align() {
    const pending = this.pending;
    if (!pending) return;
    const cell = this.cells.get(pending.index);
    if (!cell) return;
    const list = this.list();
    if (!list) return;
    // Acquisition is bounded. Once mounted, keep the anchor through even slow image
    // layouts until a user gesture or a reader geometry/navigation change cancels it.
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
    list.scrollToOffset({ offset: cell.y + cell.height * pending.offset, animated: false });
  }

  failed(info: { index: number }) {
    if (this.pending?.index === info.index) this.align();
    // initialScrollIndex can fail before native cell layouts arrive. The target
    // is already in the seeded window: wait for real geometry, never estimates.
  }

  cancel() {
    this.pending = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = undefined;
  }
}
