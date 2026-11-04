import type { SavedLoginState } from "../db/savedSyncLogin";
import type { StashSyncStatus } from "../db/syncClient";
import { Colors } from "../theme";

const indicators = {
  signedOut: { label: "Not logged in", color: Colors.textSecondary, icon: "cloud-off" },
  notSynced: { label: "Not synced", color: Colors.warning, icon: "sync-problem" },
  syncing: { label: "Syncing", color: Colors.info, icon: "sync" },
  synced: { label: "Fully synced", color: Colors.success, icon: "cloud-done" },
} as const;

/** Presentation only: never connect, prepare a replica or infer convergence from saved credentials. */
export function syncStatusIndicator(status: StashSyncStatus | null, login: SavedLoginState) {
  if (status?.disconnecting || status?.restartRequired) return indicators.notSynced;
  if (status?.authenticationRequired) return indicators.signedOut;
  if (status?.phase === "connecting" || status?.phase === "syncing") return indicators.syncing;
  if (!status?.account) {
    if (login.busy) return indicators.syncing;
    return login.account ? indicators.notSynced : indicators.signedOut;
  }
  if (status.phase !== "synced") return indicators.notSynced;
  if (status.media?.errors) return indicators.notSynced;
  // Metadata-only convergence is not completion: wait for the image queue check.
  if (!status.media || status.media.pending > 0) return indicators.syncing;
  return indicators.synced;
}
