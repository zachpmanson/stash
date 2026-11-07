import { parseHTML } from "linkedom";

export interface ReaderBlock { key: string; html: string }
export interface ReaderDocument { revision: string; blocks: ReaderBlock[] }

// Document-local identity, not a security hash. Two lanes avoid common short-hash collisions.
export function articleRevision(html: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < html.length; i++) {
    a = Math.imul(a ^ html.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ html.charCodeAt(i);
  }
  return `${html.length.toString(36)}-${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}

const layouts = new Set(["DIV", "SECTION", "ARTICLE", "MAIN", "BODY", "HTML"]);
const blocks = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "DL", "TABLE", "PRE", "BLOCKQUOTE", "FIGURE", "HR"]);

/** Split only sibling blocks. Unknown/semantic containers and mixed inline runs stay opaque.
 * Layout wrappers are retained around each child so inherited attributes/styles survive.
 * Lists, quotes, figures, tables and preformatted content are never descended into.
 */
export function chunkArticle(html: string): ReaderDocument {
  const { document } = parseHTML(`<html><body>${html}</body></html>`);
  const rows: string[] = [];
  const blockLike = (el: Element) => blocks.has(el.tagName) || layouts.has(el.tagName) ||
    Array.from(el.children).some(child => blocks.has(child.tagName) || layouts.has(child.tagName));
  const serialize = (node: Node): string => node.nodeType === 1
    ? (node as Element).outerHTML
    : node.nodeType === 3 ? (node.textContent ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") : "";
  const walk = (parent: Element, wrap: (s: string) => string) => {
    let inline = "";
    const flush = () => { if (inline.trim()) rows.push(wrap(inline)); inline = ""; };
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType !== 1) { inline += serialize(node); continue; }
      const el = node as Element;
      const tag = el.tagName;
      // A layout is transparent only when all its meaningful children are blocks/layouts.
      // Mixed text/link/image content must remain together, including unknown elements.
      const transparent = layouts.has(tag) && Array.from(el.childNodes).every(child =>
        child.nodeType === 8 || (child.nodeType === 3 && !child.textContent?.trim()) ||
        (child.nodeType === 1 && blockLike(child as Element)));
      if (transparent && el.children.length) {
        flush();
        const shell = el.cloneNode(false) as Element;
        const outer = shell.outerHTML;
        const open = outer.slice(0, outer.indexOf(">") + 1);
        walk(el, s => wrap(`${open}${s}</${el.localName}>`));
      } else if (blockLike(el)) {
        flush(); rows.push(wrap(el.outerHTML));
      } else {
        inline += el.outerHTML;
      }
    }
    flush();
  };
  walk(document.body, s => s);
  return { revision: articleRevision(html), blocks: rows.map((html, index) => ({ key: `${index}-${articleRevision(html)}`, html })) };
}
