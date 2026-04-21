// iOS encodes the shared payload as stash://dataUrl=...
// Android file shares arrive as a content:// URI — redirect both to /share.
// Everything else falls through to expo-router's default handling.
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  if (path.includes('dataUrl=') || path.startsWith('content://')) {
    return '/share';
  }
  return null;
}
