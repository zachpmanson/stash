export function hasItems<T>(arr: T[] | undefined) {
  return arr && arr.length > 0;
}

export function arrIf<T>(cond: boolean, arr: T): T[] {
  return arr ? [arr] : [];
}
