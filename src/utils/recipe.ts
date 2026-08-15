import { Recipe } from "../types";

/** Parse an ISO-8601 duration (e.g. "PT1H30M") into a compact "1h 30m" label. */
export function formatDuration(iso?: string): string | null {
  if (!iso) return null;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  if (!m) return null;
  const parts: string[] = [];
  if (m[1]) parts.push(`${m[1]}h`);
  if (m[2]) parts.push(`${m[2]}m`);
  return parts.join(" ") || null;
}

/** Human "cook time" label for a recipe, falling back to total/prep time. */
export function recipeCookLabel(recipe: Recipe | null): string | null {
  if (!recipe) return null;
  const t =
    formatDuration(recipe.cookTime) ??
    formatDuration(recipe.totalTime) ??
    formatDuration(recipe.prepTime);
  if (!t) return null;
  return `${t} cook`;
}

/** Safely parse a stored recipe JSON blob. */
export function parseRecipe(json: string | null | undefined): Recipe | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Recipe;
  } catch {
    return null;
  }
}
