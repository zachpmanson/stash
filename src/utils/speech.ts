/** Estimated words-per-minute of the device's default TTS at rate 1.0. */
export const TTS_WORDS_PER_MINUTE = 150;

export function wordsToSeconds(words: number): number {
  return (words / TTS_WORDS_PER_MINUTE) * 60;
}
