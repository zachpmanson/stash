import { useEffect, useMemo, useState } from "react";
import { fetchArticle } from "../utils/readability";
import { normalizeText, splitSentences } from "src/utils/sentences";

export type ArticleState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string | null; text: string }
  | { kind: "error"; message: string };

export function useArticle(url: string | undefined): {
  state: ArticleState;
  sentences: string[] | undefined;
} {
  const [state, setState] = useState<ArticleState>({ kind: "idle" });
  const sentences = useMemo(() => {
    if (state.kind === "ready" && state.text) return splitSentences(normalizeText(state.text));
  }, [state]);

  useEffect(() => {
    if (!url) {
      setState({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setState({ kind: "loading" });
    fetchArticle(url)
      .then(({ title, text }) => {
        if (cancelled) return;
        setState({ kind: "ready", title, text });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ kind: "error", message: err?.message ?? "Failed to load article" });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return { state, sentences };
}
