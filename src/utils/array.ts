export function hasItems<T>(arr: T[] | undefined) {
  return arr && arr.length > 0;
}
