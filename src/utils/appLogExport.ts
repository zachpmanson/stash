import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";
import { expo } from "../../app.json";
import { formatAppLog } from "./appLogs";
import { randomId } from "./randomId";

let sharing = false;

export async function exportAppLogs(): Promise<void> {
  if (sharing) return;
  sharing = true;
  try {
    if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing unavailable");
    // Give each share a fresh URI so a previous recipient cannot read a later
    // export. Keep recent snapshots for receivers that open them asynchronously.
    const directory = new Directory(Paths.cache, "stash-log-exports");
    directory.create({ idempotent: true });
    const old = directory.list().filter((entry): entry is File => entry instanceof File && entry.name.startsWith("stash-logs-"));
    old.sort((a, b) => b.name.localeCompare(a.name));
    for (const file of old.slice(7)) {
      try { file.delete(); } catch { /* Cache cleanup is best-effort. */ }
    }
    const now = new Date();
    const file = new File(directory, `stash-logs-${now.getTime()}-${randomId()}.txt`);
    file.create();
    file.write(`Stash ${expo.version} (${Platform.OS})\nExported ${now.toISOString()}\n\n${formatAppLog()}`);
    await Sharing.shareAsync(file.uri, { mimeType: "text/plain", UTI: "public.plain-text", dialogTitle: "Export Stash logs" });
  } finally {
    sharing = false;
  }
}
