// Keep in sync with native src/components/FolderCard.tsx. The standalone
// server package cannot import native app sources outside its build boundary.
const INITIAL_ICONS: Record<string, string> = {
  a: "🅰️", b: "📚", c: "💾", d: "📄", e: "✉️", f: "📁",
  g: "🎮", h: "🏠", i: "💡", j: "📓", k: "🔑", l: "🔗",
  m: "🎵", n: "📰", o: "🌐", p: "📌", q: "❓", r: "🔴",
  s: "⭐", t: "🏷️", u: "🔵", v: "🎬", w: "🌊", x: "❌",
  y: "💛", z: "⚡",
};

export function folderIcon(folder: { id: string; name: string; icon?: string | null }): string {
  if (folder.icon) return folder.icon;
  if (folder.id === "inbox") return "📥";
  const first = folder.name.trim()[0]?.toLowerCase() ?? "📁";
  return INITIAL_ICONS[first] ?? "📁";
}
