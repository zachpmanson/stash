import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { normalizeText } from "./sentences";
import type { HowToStep, Recipe } from "../types";

export type VoiceMode = "primary" | "quote";

export type Article = {
  title: string | null;
  html: string;
};

export type TextBlock = {
  text: string;
  mode: VoiceMode;
};

export function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  const body = document.body;
  const root = (body && body.childNodes.length > 0
    ? body
    : (document.documentElement ?? document)) as unknown as DomNode;
  return normalizeText(extractText(root));
}

export function htmlToBlocks(html: string): TextBlock[] {
  const { document } = parseHTML(html);
  const body = document.body;
  const root = (body && body.childNodes.length > 0
    ? body
    : (document.documentElement ?? document)) as unknown as DomNode;
  const blocks: BlockBuilder[] = [];
  const state: WalkState = { depth: 0, current: null };
  walkBlocks(root, blocks, state);
  flushBlock(blocks, state);
  return blocks
    .map((b) => ({ text: cleanBlockText(b.parts.join("")), mode: b.mode }))
    .filter((b) => b.text.length > 0);
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

type BlockBuilder = { parts: string[]; mode: VoiceMode };
type WalkState = { depth: number; current: BlockBuilder | null };

function walkBlocks(node: DomNode | null | undefined, out: BlockBuilder[], state: WalkState): void {
  if (!node) return;
  if (node.nodeType === 3) {
    const text = (node.nodeValue ?? "").replace(/\s+/g, " ");
    if (!text) return;
    if (!state.current) state.current = { parts: [], mode: state.depth > 0 ? "quote" : "primary" };
    state.current.parts.push(text);
    return;
  }
  if (node.nodeType !== 1) {
    if (node.childNodes) for (const child of Array.from(node.childNodes)) walkBlocks(child, out, state);
    return;
  }
  const tag = (node.tagName ?? "").toLowerCase();
  if (SKIP_TAGS.has(tag)) return;
  if (tag === "br" || tag === "hr") {
    flushBlock(out, state);
    return;
  }
  const isBlock = BLOCK_TAGS.has(tag);
  const isQuote = tag === "blockquote";
  if (isBlock) flushBlock(out, state);
  if (isQuote) state.depth += 1;
  if (node.childNodes) for (const child of Array.from(node.childNodes)) walkBlocks(child, out, state);
  if (isQuote) state.depth -= 1;
  if (isBlock) flushBlock(out, state);
}

function flushBlock(out: BlockBuilder[], state: WalkState): void {
  if (state.current) {
    out.push(state.current);
    state.current = null;
  }
}

function cleanBlockText(s: string): string {
  return normalizeText(s.replace(/[ \t]+/g, " ").trim());
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

export async function fetchArticle(
  url: string,
  opts: { useLargestTextBlock?: boolean } = {},
): Promise<Article & { recipe?: Recipe }> {
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

  // Detect Recipe JSON-LD before falling through to Readability
  const recipe = findRecipe(html);

  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document).parse();

  let contentHtml: string | null = parsed?.content ?? null;
  const title: string | null = parsed?.title ?? (recipe?.name ?? null);

  // Aggressive mode: when Readability misses (grabbing a short boilerplate block
  // instead of the real body), fall back to the largest block of <p> text on the
  // page. Only engage when it's clearly bigger than what Readability produced.
  // NB: scan a FRESH parse — Readability mutates the document it processes, so
  // re-scanning the parsed DOM loses the original paragraph structure.
  if (opts.useLargestTextBlock) {
    const fresh = parseHTML(html).document;
    const largest = findLargestTextBlock(fresh.documentElement as unknown as Element);
    if (largest && largest.html.length > (contentHtml?.length ?? 0) * 1.5) {
      contentHtml = largest.html;
    }
  }

  if (!contentHtml) {
    throw new Error("Could not extract article from this page");
  }

  const cleanedHtml = stripStyling(contentHtml);
  if (!htmlToText(cleanedHtml)) {
    throw new Error("Could not extract article from this page");
  }

  return {
    title,
    html: cleanedHtml,
    ...(recipe ? { recipe } : {}),
  };
}

/**
 * Find the element with the largest total descendant <p> text on the page,
 * excluding <body>/<html> so whole-page layouts don't win. On ties prefers the
 * deepest node so we return the most specific container. Returns null if the
 * page has no paragraphs at all. Used by the "aggressive extraction" fallback.
 */
function findLargestTextBlock(root: Element): { html: string } | null {
  const best = { el: null as Element | null, len: 0, depth: -1 };

  const visit = (el: Element, depth: number) => {
    const tag = (el.tagName || "").toLowerCase();
    if (tag !== "body" && tag !== "html") {
      const ps = Array.from(el.querySelectorAll("p"));
      let len = 0;
      for (const p of ps) len += (p.textContent ?? "").replace(/\s+/g, " ").trim().length;
      if (ps.length > 0 && (len > best.len || (len === best.len && depth > best.depth))) {
        best.el = el;
        best.len = len;
        best.depth = depth;
      }
    }
    for (const child of Array.from(el.children)) visit(child as Element, depth + 1);
  };

  visit(root, 0);
  if (!best.el) return null;
  return { html: best.el.innerHTML };
}

/**
 * Scan HTML for a JSON-LD script block with @type: "Recipe".
 * Returns the parsed Recipe or null if none found.
 */
export function findRecipe(html: string): Recipe | null {
  const scriptRegex = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      const raw = match[1].trim();
      // Handle both array responses and single objects
      const parsed = JSON.parse(raw);
      const graph = Array.isArray(parsed) ? parsed : parsed["@graph"] ?? [parsed];
      for (const item of graph) {
        const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
        if (types.includes("Recipe")) {
          return normalizeRecipe(item);
        }
      }
    } catch {
      // Malformed JSON — skip this script block
    }
  }
  return null;
}

function normalizeRecipe(raw: Record<string, any>): Recipe {
  const instructions: HowToStep[] = [];
  const rawInstructions = raw.recipeInstructions ?? [];
  for (const step of Array.isArray(rawInstructions) ? rawInstructions : []) {
    if (typeof step === "string") {
      instructions.push({ text: step });
    } else if (step?.text) {
      instructions.push({ text: step.text, name: step.name, image: step.image });
    }
  }

  const ingredients: string[] = [];
  for (const ing of Array.isArray(raw.recipeIngredient) ? raw.recipeIngredient : []) {
    if (typeof ing === "string") ingredients.push(ing);
  }

  return {
    name: String(raw.name ?? ""),
    description: raw.description ? String(raw.description) : undefined,
    image: raw.image
      ? Array.isArray(raw.image)
        ? raw.image[0]?.url
        : typeof raw.image === "string"
          ? raw.image
          : raw.image?.url
      : undefined,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    prepTime: raw.prepTime ? String(raw.prepTime) : undefined,
    cookTime: raw.cookTime ? String(raw.cookTime) : undefined,
    totalTime: raw.totalTime ? String(raw.totalTime) : undefined,
    recipeYield: raw.recipeYield ? String(raw.recipeYield) : undefined,
    nutrition: raw.nutrition?.calories
      ? { calories: String(raw.nutrition.calories) }
      : undefined,
    author: raw.author
      ? typeof raw.author === "string"
        ? raw.author
        : raw.author?.name
      : undefined,
    datePublished: raw.datePublished ? String(raw.datePublished) : undefined,
  };
}

function stripStyling(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*rel=["']?stylesheet["']?[^>]*>/gi, "")
    .replace(/\s(style|class)="[^"]*"/gi, "")
    .replace(/\s(style|class)='[^']*'/gi, "");
}
