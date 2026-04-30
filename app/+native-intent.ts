import { getSharedPayloads } from "expo-sharing";
import { getActiveListenItemId } from "../src/state/listenSession";
// iOS encodes the shared payload as stash://dataUrl=...
// Android file shares arrive as a content:// URI — redirect both to /share.
// Native media-session notification taps arrive as stash://listen — redirect
// to the active Listen screen.
// Everything else falls through to expo-router's default handling.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string | null {
  console.debug({
    path,
    initial,
    getSharedPayloads: getSharedPayloads(),
  });
  try {
    if (path.startsWith("stash://listen") || path === "/listen") {
      const id = getActiveListenItemId();
      return id ? `/listen/${id}` : "/";
    }
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
}
