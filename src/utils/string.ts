export function visibleLength(str: string) {
  return [...new Intl.Segmenter().segment(str)].length;
}
