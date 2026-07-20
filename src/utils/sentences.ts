import type { TextBlock, VoiceMode } from "./readability";

export type Sentence = { text: string; mode: VoiceMode };

const ASCII_REPLACEMENTS: Array<[RegExp, string]> = [
  [/“|”/g, '"'],
  [/‘|’/g, "'"],
  [/—/g, "--"],
  [/–/g, "-"],
  [/…/g, "..."],
  [/ /g, " "],
  [/“/g, '"'],
  [/”/g, '"'],
];

export function normalizeText(s: string): string {
  let out = s;
  for (const [re, rep] of ASCII_REPLACEMENTS) out = out.replace(re, rep);
  return out;
}

const SPLIT_RE = /[^.][^A-Z][.!?]["'\)]?[\n ]/g;

// Common English abbreviations that end with a period but aren't sentence endings
const ABBREVIATIONS = [
  // Titles
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'rev', 'sen', 'rep',
  // Common abbreviations
  'jr', 'sr', 'ii', 'iii', 'iv',
  'vs', 'etc', 'al', 'vol', 'no',
  // Academic/professional
  'phd', 'md', 'esq', 'ltd', 'inc', 'corp',
];

function splitLine(line: string): string[] {
  // Find all potential sentence breaks
  const matches: Array<{index: number, end: number}> = [];
  SPLIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SPLIT_RE.exec(line)) !== null) {
    matches.push({ index: m.index, end: m.index + m[0].length });
  }
  
  // Filter out matches that are abbreviations
  const validMatches = matches.filter(({ index, end }) => {
    // Get the word before the period (e.g., "Mr" from "Mr.")
    const before = line.slice(Math.max(0, index - 20), index);
    const match = before.match(/\s([a-z]+)\.$/i);
    if (!match) return true;
    // Check if it's a known abbreviation
    return !ABBREVIATIONS.includes(match[1].toLowerCase());
  });
  
  const result: string[] = [];
  let pos = 0;
  for (const { end } of validMatches) {
    const s = line.slice(pos, end).trim();
    if (s) result.push(s);
    pos = end;
  }
  const tail = line.slice(pos).trim();
  if (tail) result.push(tail);
  return result;
}
  const result: string[] = [];
  let pos = 0;
  let m: RegExpExecArray | null;
  SPLIT_RE.lastIndex = 0;
  while ((m = SPLIT_RE.exec(line)) !== null) {
    const end = m.index + m[0].length;
    const s = line.slice(pos, end).trim();
    if (s) result.push(s);
    pos = end;
  }
  const tail = line.slice(pos).trim();
  if (tail) result.push(tail);
  return result;
}

export function splitSentences(text: string): string[] {
  const result: string[] = [];
  for (const para of text.split(/\n\n+/)) {
    const trimmed = para.trim();
    if (!trimmed) continue;
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      result.push(...splitLine(t));
    }
  }
  return result;
}

export function splitSentencesFromBlocks(blocks: TextBlock[]): Sentence[] {
  const result: Sentence[] = [];
  for (const block of blocks) {
    const trimmed = block.text.trim();
    if (!trimmed) continue;
    for (const line of trimmed.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      for (const text of splitLine(t)) {
        result.push({ text, mode: block.mode });
      }
    }
  }
  return result;
}
