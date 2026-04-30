import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArticle, htmlToText } from "../utils/readability";
import { normalizeText, splitSentences } from "src/utils/sentences";
import { updateItemArticleHtml } from "../db/items";

export type ArticleState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string | null; text: string; html: string | null }
  | { kind: "error"; message: string };

function buildReady(title: string | null, html: string | null, fallbackText: string | null): ArticleState {
  const text = html ? htmlToText(html) : (fallbackText ?? "");
  return { kind: "ready", title, text, html };
}

export function useArticle(
  url: string | undefined,
  itemId?: string,
  initialText?: string | null,
  initialHtml?: string | null,
): {
  state: ArticleState;
  sentences: string[] | undefined;
  refresh: () => Promise<void>;
  loadFrom: (sourceUrl: string) => Promise<void>;
  refreshing: boolean;
} {
  const [state, setState] = useState<ArticleState>(
    initialHtml || initialText ? buildReady(null, initialHtml ?? null, initialText ?? null) : { kind: "idle" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  const sentences = useMemo(() => {
    if (state.kind === "ready" && state.text) return splitSentences(normalizeText(state.text));
  }, [state]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!url) {
      setState({ kind: "idle" });
      return;
    }
    if (initialHtml || initialText) {
      setState(buildReady(null, initialHtml ?? null, initialText ?? null));
      return;
    }
    setState({ kind: "loading" });
    fetchArticle(url)
      .then(({ title, html }) => {
        if (cancelledRef.current) return;
        setState(buildReady(title, html, null));
        if (itemId) updateItemArticleHtml(itemId, html).catch(() => {});
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        setState({ kind: "error", message: err?.message ?? "Failed to load article" });
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [url, itemId, initialText, initialHtml]);

  const refresh = useCallback(async () => {
    if (!url) return;
    setRefreshing(true);
    try {
      const { title, html } = await fetchArticle(url);
      setState(buildReady(title, html, null));
      if (itemId) await updateItemArticleHtml(itemId, html);
    } catch (err) {
      setState({ kind: "error", message: (err as Error)?.message ?? "Failed to load article" });
    } finally {
      setRefreshing(false);
    }
  }, [url, itemId]);

  const loadFrom = useCallback(
    async (sourceUrl: string) => {
      setRefreshing(true);
      setState({ kind: "loading" });
      try {
        const { title, html } = await fetchArticle(sourceUrl);
        setState(buildReady(title, html, null));
        if (itemId) await updateItemArticleHtml(itemId, html);
      } catch (err) {
        setState({ kind: "error", message: (err as Error)?.message ?? "Failed to load article" });
      } finally {
        setRefreshing(false);
      }
    },
    [itemId],
  );

  return { state, sentences, refresh, loadFrom, refreshing };
}
