/**
 * Australian English recipe conversions.
 *
 * Two independent passes (so each can be triggered separately):
 *  - `convertToAustralian`  — name swaps + temperature + weight. Kept behind
 *    the "Australian recipe ingredients" settings toggle.
 *  - `convertVolumeUnits`   — US fluid-volume → ml. Deliberately NOT in the
 *    auto toggle (an AU recipe is already metric, and "cups" are ambiguous),
 *    so it only fires when the user presses "Convert volumes" in the recipe
 *    overflow menu.
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

/** Unicode vulgar fractions (½, ⅓, …) → fraction terms with a leading space
 * so an attached integer becomes a mixed number ("1½" → "1 1/2"). */
const VULGAR: Record<string, string> = {
  "¼": " 1/4", "½": " 1/2", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3",
  "⅛": " 1/8", "⅜": " 3/8", "⅝": " 5/8", "⅞": " 7/8",
};
const VULGAR_RE = /[¼½¾⅓⅔⅛⅜⅝⅞]/g;

/** Parse "3", "3.5", "1/2", "1 1/2", "1½" into a number, else null. */
function parseAmount(s: string): number | null {
  const t = s.replace(VULGAR_RE, (c) => `${VULGAR[c]}`).trim();
  // Mixed number "1 1/2" or "1-1/2"
  const m =
    t.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+)\s*\/\s*(\d+)$/) ||
    t.match(/^(\d+(?:\.\d+)?)\s+(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  // Simple fraction "1/2"
  const f = t.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (f) return Number(f[1]) / Number(f[2]);
  const d = Number(t);
  return Number.isFinite(d) ? d : null;
}

/** Round to a kitchen-friendly value. */
function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "";
  const a = Math.abs(n);
  if (a < 1) return `${Math.round(n * 10) / 10}`;
  if (a < 10) return `${Math.round(n * 2) / 2}`;
  return `${Math.round(n / 5) * 5}`;
}

/** Amount regex: "3", "3.5", "1/2", "1 1/2", "1½", "1 ½", "½". */
const AMOUNT = String.raw`(?:\d+(?:\.\d+)?(?:\s+|\s*[-–]\s*)\d+\s*\/\s*\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\d+\s*[\u00BC-\u00BE\u2150-\u215E]|[\u00BC-\u00BE\u2150-\u215E])`;

/** Volume units only (fl oz first so it wins over plain oz). */
const VOLUME_UNIT = `(fl\\s*oz|cups?|tbsp?|tsp)\\b`;
const VOLUME_FACTOR: Record<string, number> = {
  cup: 250,
  cups: 250,
  tbsp: 15,
  tsp: 5,
  floz: 30,
};

/** Weight units only. */
const WEIGHT_UNIT = `(lbs?|pounds?|oz)\\b`;

/** Australian name + temperature + weight conversion. */
export function convertToAustralian(text: string): string {
  let out = text;

  // 1) Name swaps (whole word, case-insensitive, optional plural).
  for (const [find, replace] of AU_INGREDIENT_MAP) {
    const escaped = find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}s?\\b`, "gi"), replace);
  }

  // 2) Temperature °F → °C (nearest 5°). Ranges first ("350-375°F").
  const c2c = (n: string) => `${Math.round(((Number(n) - 32) * 5) / 9 / 5) * 5}°C`;
  out = out.replace(/(\d{2,3})\s*[-–]\s*(\d{2,3})\s*(?:°\s*[fF]|degrees?\s*[fF](?:ahrenheit)?)/g, (f, a, b) => `${c2c(a)}–${c2c(b)}`);
  out = out.replace(
    /(\d{2,3})\s*(?:°\s*|degrees?\s*)?[fF](?:ahrenheit)?\b/gi,
    (full, n: string) => c2c(n),
  );

  // 3) Weight (oz/lb → g).
  out = out.replace(
    new RegExp(`(${AMOUNT})\\s*(${WEIGHT_UNIT})`, "gi"),
    (full, amt: string, unit: string) => {
      const n = parseAmount(amt);
      if (n === null) return full;
      const u = unit.toLowerCase().replace(/[\s.]/g, "");
      let g: number | null = null;
      if (u === "lb" || u === "lbs" || u === "pound" || u === "pounds") g = n * 454;
      else if (u === "oz") g = n * 28.35;
      return g !== null ? `${fmtQty(g)} g` : full;
    },
  );

  return out;
}

/** US fluid-volume (cups/tbsp/tsp/fl oz) → ml. Manual, opt-in only. */
export function convertVolumeUnits(text: string): string {
  return text.replace(
    new RegExp(`(${AMOUNT})\\s*(${VOLUME_UNIT})`, "gi"),
    (full, amt: string, unit: string) => {
      const n = parseAmount(amt);
      if (n === null) return full;
      const u = unit.toLowerCase().replace(/[\s.]/g, "");
      const f = VOLUME_FACTOR[u];
      return f !== undefined ? `${fmtQty(n * f)} ml` : full;
    },
  );
}