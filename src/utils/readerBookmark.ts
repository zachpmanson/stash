export type ReaderMode = "plain" | "raw" | "sentences" | "recipe";
export type ReaderBookmark =
  | { version: 1; kind: "article"; revision: string; blockKey: string; offset: number }
  | { version: 1; kind: "scroll"; mode: ReaderMode; fraction: number };

export function parseReaderBookmark(json: string): ReaderBookmark | null {
  try {
    const value = JSON.parse(json);
    if (!value || value.version !== 1) return null;
    const unit = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
    const key = (s: unknown) => typeof s === "string" && s.length > 0 && s.length <= 256;
    if (value.kind === "article" && key(value.revision) && key(value.blockKey) && unit(value.offset)) {
      return { version: 1, kind: "article", revision: value.revision, blockKey: value.blockKey, offset: value.offset };
    }
    if (value.kind === "scroll" && ["plain", "raw", "sentences", "recipe"].includes(value.mode) && unit(value.fraction)) {
      return { version: 1, kind: "scroll", mode: value.mode, fraction: value.fraction };
    }
  } catch { /* Invalid/old bookmarks are not navigation instructions. */ }
  return null;
}
