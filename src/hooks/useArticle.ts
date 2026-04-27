import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArticle } from "../utils/readability";
import { normalizeText, splitSentences } from "src/utils/sentences";
import { updateItemArticleText } from "../db/items";

export type ArticleState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string | null; text: string }
  | { kind: "error"; message: string };

export function useArticle(
  url: string | undefined,
  itemId?: string,
  initialText?: string | null,
): {
  state: ArticleState;
  sentences: string[] | undefined;
  refresh: () => Promise<void>;
  refreshing: boolean;
} {
  const [state, setState] = useState<ArticleState>(
    initialText ? { kind: "ready", title: null, text: initialText } : { kind: "idle" },
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
    if (initialText) {
      setState({ kind: "ready", title: null, text: initialText });
      return;
    }
    setState({ kind: "loading" });
    fetchArticle(url)
      .then(({ title, text }) => {
        if (cancelledRef.current) return;
        setState({ kind: "ready", title, text });
        if (itemId) updateItemArticleText(itemId, text).catch(() => {});
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        setState({ kind: "error", message: err?.message ?? "Failed to load article" });
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [url, itemId, initialText]);

  const refresh = useCallback(async () => {
    if (!url) return;
    setRefreshing(true);
    try {
      const { title, text } = await fetchArticle(url);
      setState({ kind: "ready", title, text });
      if (itemId) await updateItemArticleText(itemId, text);
    } catch (err) {
      setState({ kind: "error", message: (err as Error)?.message ?? "Failed to load article" });
    } finally {
      setRefreshing(false);
    }
  }, [url, itemId]);

  return { state, sentences, refresh, refreshing };
}
