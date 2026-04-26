import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

export type Article = {
  title: string | null;
  text: string;
};

export async function fetchArticle(url: string): Promise<Article> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StashBot/1.0)' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } finally {
    clearTimeout(timeout);
  }

  const { document } = parseHTML(html);
  const parsed = new Readability(document as unknown as Document).parse();
  if (!parsed || !parsed.textContent) {
    throw new Error('Could not extract article from this page');
  }

  return {
    title: parsed.title ?? null,
    text: parsed.textContent.trim(),
  };
}
