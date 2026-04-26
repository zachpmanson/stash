import { LinkPreview } from '../types';

const META_TAGS = ['og:title', 'og:description', 'og:image', 'og:site_name',
                   'twitter:title', 'twitter:description', 'twitter:image'];

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StashBot/1.0)' },
    });
    clearTimeout(timeout);

    const html = await res.text();
    const metas = parseMetaTags(html);

    const title = metas['og:title'] ?? metas['twitter:title'] ?? parseTitle(html) ?? null;
    const description = metas['og:description'] ?? metas['twitter:description'] ?? null;
    const image = metas['og:image'] ?? metas['twitter:image'] ?? null;

    const { hostname } = new URL(url);
    const favicon = `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`;

    return { title, description, image: resolveUrl(image, url), favicon };
  } catch {
    const { hostname } = new URL(url);
    return {
      title: hostname,
      description: null,
      image: null,
      favicon: `https://www.google.com/s2/favicons?domain=${hostname}&sz=64`,
    };
  }
}

function parseMetaTags(html: string): Record<string, string> {
  const result: Record<string, string> = {};
  const metaRegex = /<meta[^>]+>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaRegex.exec(html)) !== null) {
    const tag = match[0];
    const propertyMatch = /(?:property|name)=["']([^"']+)["']/i.exec(tag);
    const contentMatch = /content=["']([^"']*)["']/i.exec(tag);

    if (propertyMatch && contentMatch) {
      const prop = propertyMatch[1].toLowerCase();
      if (META_TAGS.includes(prop)) {
        result[prop] = decodeHtmlEntities(contentMatch[1]);
      }
    }
  }
  return result;
}

function parseTitle(html: string): string | null {
  const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  lbrack: '[',
  rbrack: ']',
  lbrace: '{',
  rbrace: '}',
  lpar: '(',
  rpar: ')',
};

function decodeHtmlEntities(str: string): string {
  return str.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return match;
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named ?? match;
  });
}

function resolveUrl(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
