import { getSharedPayloads } from "expo-sharing";
// iOS encodes the shared payload as stash://dataUrl=...
// Android file shares arrive as a content:// URI — redirect both to /share.
// Everything else falls through to expo-router's default handling.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  console.debug({
    path,
    initial,
    getSharedPayloads: getSharedPayloads(),
  });
  try {
    // Share intents: route to home and let _layout push /share as a modal
    // once useIncomingShare surfaces the payload. Routing to /share directly
    // would make it the only entry in the stack (no / to back to).
    if (new URL(path).hostname === "expo-sharing") {
      return "/";
    }
    return path;
  } catch {
    // Fallback to the root path  on error
    return "/";
  }
  // if (path.includes("dataUrl=") || path.startsWith("content://")) {
  // return "/share";
  // }
  return null;
}
