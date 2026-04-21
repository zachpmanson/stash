// On iOS, expo-share-intent encodes the shared file as stash://dataUrl=...
// On Android, file shares open the app with a content:// URI as the intent data.
// Route both cases to /share so the hook picks them up.
// Return null for everything else so expo-router uses its built-in handling.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (path.includes('dataUrl=') || path.startsWith('content://')) {
    return '/share';
  }
  return null;
}
