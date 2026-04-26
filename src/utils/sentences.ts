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

function splitLine(line: string): string[] {
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

export function insertParagraphBreaks(text: string) {
  return text.replace(/\.([A-Z][a-z])/g, ".\n$1");
}
