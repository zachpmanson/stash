import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeText } from "./sentences";

export type Article = {
  title: string | null;
  html: string;
};

export function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  const body = document.body;
  const root = (body && body.childNodes.length > 0
    ? body
    : (document.documentElement ?? document)) as unknown as DomNode;
  return normalizeText(extractText(root));
}

export function archiveIsUrl(url: string): string {
  return `https://archive.ph/newest/${url}`;
}

export function archiveOrgUrl(url: string): string {
  return `https://web.archive.org/web/2/${url}`;
}

const BLOCK_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "li",
  "pre",
  "figcaption",
  "div",
  "section",
  "article",
  "tr",
]);

const SKIP_TAGS = new Set([
  "script",
  "style",
  "noscript",
  "iframe",
  "img",
  "svg",
  "video",
  "audio",
  "picture",
  "source",
  "canvas",
  "object",
  "embed",
]);

type DomNode = {
  nodeType?: number;
  nodeValue?: string | null;
  tagName?: string;
  childNodes?: ArrayLike<DomNode>;
};

function walk(node: DomNode | null | undefined, out: string[]): void {
  if (!node) return;
  if (node.nodeType === 3) {
    out.push((node.nodeValue ?? "").replace(/\s+/g, " "));
    return;
  }
  if (node.nodeType !== 1) {
    if (node.childNodes) for (const child of Array.from(node.childNodes)) walk(child, out);
    return;
  }
  const tag = (node.tagName ?? "").toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if (tag === "br") {
    out.push("\n");
    return;
  }
  if (tag === "hr") {
    out.push("\n\n");
    return;
  }
  const isBlock = BLOCK_TAGS.has(tag);
  if (isBlock) out.push("\n\n");
  if (node.childNodes) for (const child of Array.from(node.childNodes)) walk(child, out);
  if (isBlock) out.push("\n\n");
}

function extractText(root: DomNode): string {
  const parts: string[] = [];
  walk(root, parts);
  return parts
    .join("")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchArticle(url: string): Promise<Article> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; StashBot/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed || !parsed.content) {
    throw new Error("Could not extract article from this page");
  }

  const cleanedHtml = stripStyling(parsed.content);
  if (!htmlToText(cleanedHtml)) {
    throw new Error("Could not extract article from this page");
  }

  return {
    title: parsed.title ?? null,
    html: cleanedHtml,
  };
}

function stripStyling(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "")
    .replace(/\s(style|class)="[^"]*"/gi, "")
    .replace(/\s(style|class)='[^']*'/gi, "");
}
