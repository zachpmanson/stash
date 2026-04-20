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

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function resolveUrl(url: string | null, base: string): string | null {
  if (!url) return null;
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}
