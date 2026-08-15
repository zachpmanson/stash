import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchArticle, findRecipe, htmlToBlocks, htmlToText } from "../utils/readability";
import { normalizeText, Sentence, splitSentences, splitSentencesFromBlocks } from "src/utils/sentences";
import { updateItemArticleHtml, updateItemRecipeJson } from "../db/items";
import type { Recipe } from "../types";

export type ArticleState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; title: string | null; text: string; html: string | null; recipe: Recipe | null }
  | { kind: "error"; message: string };

function buildReady(title: string | null, html: string | null, fallbackText: string | null, recipe: Recipe | null = null): ArticleState {
  const text = html ? htmlToText(html) : (fallbackText ?? "");
  return { kind: "ready", title, text, html, recipe };
}

/** Resolve the recipe for a stored article: prefer persisted recipe_json, else scan the stored HTML. */
function storedRecipe(recipeJson: string | null | undefined, html: string | null | undefined): Recipe | null {
  if (recipeJson) {
    try {
      return JSON.parse(recipeJson) as Recipe;
    } catch {
      // Malformed — fall through to scanning HTML
    }
  }
  if (html) {
    try {
      return findRecipe(html);
    } catch {
      // Ignore scan failures
    }
  }
  return null;
}

export function useArticle(
  url: string | undefined,
  itemId?: string,
  initialText?: string | null,
  initialHtml?: string | null,
  initialRecipeJson?: string | null,
): {
  state: ArticleState;
  sentences: Sentence[] | undefined;
  refresh: () => Promise<void>;
  loadFrom: (sourceUrl: string) => Promise<void>;
  refreshing: boolean;
} {
  const [state, setState] = useState<ArticleState>(
    initialHtml || initialText
      ? buildReady(
          null,
          initialHtml ?? null,
          initialText ?? null,
          storedRecipe(initialRecipeJson, initialHtml ?? null),
        )
      : { kind: "idle" },
  );
  const [refreshing, setRefreshing] = useState(false);
  const cancelledRef = useRef(false);

  const sentences = useMemo<Sentence[] | undefined>(() => {
    if (state.kind !== "ready") return undefined;
    if (state.html) return splitSentencesFromBlocks(htmlToBlocks(state.html));
    if (state.text) {
      return splitSentences(normalizeText(state.text)).map((text) => ({ text, mode: "primary" as const }));
    }
    return undefined;
  }, [state]);

  useEffect(() => {
    cancelledRef.current = false;
    if (!url) {
      setState({ kind: "idle" });
      return;
    }
    if (initialHtml || initialText) {
      setState(
        buildReady(
          null,
          initialHtml ?? null,
          initialText ?? null,
          storedRecipe(initialRecipeJson, initialHtml ?? null),
        ),
      );
      return;
    }
    setState({ kind: "loading" });
    fetchArticle(url)
      .then(({ title, html, recipe }) => {
        if (cancelledRef.current) return;
        setState(buildReady(title, html, null, recipe ?? null));
        if (itemId) {
          updateItemArticleHtml(itemId, html, html ? htmlToText(html) : null).catch(() => {});
          if (recipe) updateItemRecipeJson(itemId, JSON.stringify(recipe)).catch(() => {});
        }
      })
      .catch((err) => {
        if (cancelledRef.current) return;
        setState({ kind: "error", message: err?.message ?? "Failed to load article" });
      });
    return () => {
      cancelledRef.current = true;
    };
  }, [url, itemId, initialText, initialHtml, initialRecipeJson]);

  const refresh = useCallback(async () => {
    if (!url) return;
    setRefreshing(true);
    try {
      const { title, html, recipe } = await fetchArticle(url);
      setState(buildReady(title, html, null, recipe ?? null));
      if (itemId) {
        await updateItemArticleHtml(itemId, html, html ? htmlToText(html) : null);
        if (recipe) await updateItemRecipeJson(itemId, JSON.stringify(recipe));
      }
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
        const { title, html, recipe } = await fetchArticle(sourceUrl);
        setState(buildReady(title, html, null, recipe ?? null));
        if (itemId) {
          await updateItemArticleHtml(itemId, html, html ? htmlToText(html) : null);
          if (recipe) await updateItemRecipeJson(itemId, JSON.stringify(recipe));
        }
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
