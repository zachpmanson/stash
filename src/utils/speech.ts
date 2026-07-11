/** Estimated words-per-minute of the device's default TTS at rate 1.0. */
export const TTS_WORDS_PER_MINUTE = 150;

export function wordsToSeconds(words: number): number {
  return (words / TTS_WORDS_PER_MINUTE) * 60;
}

export function estimateReadLabel(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;
  const seconds = wordsToSeconds(words);
  if (seconds < 60) return "<1 min read";
  return `${Math.round(seconds / 60)} min read`;
}
