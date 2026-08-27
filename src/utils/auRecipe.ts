/**
 * Australian English recipe conversions.
 *
 * Maps US/UK ingredient names to the terms Australians actually use at the
 * shop ("as-spoken"). Many terms are identical in AU (zucchini, eggplant,
 * snow pea) and are deliberately NOT in this list. Word-boundary, case-
 * insensitive whole-term replacement.
 */
const AU_INGREDIENT_MAP: ReadonlyArray<readonly [string, string]> = [
  ["marjoram", "oregano"],
  ["arugula", "rocket"],
  ["cilantro", "coriander"],
  ["bell pepper", "capsicum"],
  ["scallion", "spring onion"],
  ["green onion", "spring onion"],
  ["ground beef", "minced beef"],
  ["all-purpose flour", "plain flour"],
  ["cornstarch", "corn flour"],
];

export function convertToAustralian(text: string): string {
  let out = text;
  for (const [find, replace] of AU_INGREDIENT_MAP) {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}s?\\b`, "gi"), replace);
  }
  return out;
}