import { File, Paths } from "expo-file-system";

const EVENTS = [
  "app.started", "settings.load_failed",
  "item.share_saved", "item.share_failed",
  "backup.created", "backup.failed", "restore.completed", "restore.failed",
  "sync.connecting", "sync.syncing", "sync.synced", "sync.stopped", "sync.error",
  "sync.authentication_required", "sync.restart_required", "sync.images_complete",
  "image.upload_failed", "image.download_failed",
] as const;
type Event = typeof EVENTS[number];
type Entry = [number, Event] | [number, Event, number];
const allowed = new Set<string>(EVENTS);
const MAX_ENTRIES = 200;
const MAX_CACHE_BYTES = 24 * 1024;
let entries: Entry[] | undefined;

function isMediaStatus(event: Event, code: unknown): code is number {
  return (event === "image.upload_failed" || event === "image.download_failed") &&
    typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599;
}

function logFile() { return new File(Paths.cache, "stash-app-events-v1.json"); }

function getEntries(): Entry[] {
  if (entries) return entries;
  entries = [];
  try {
    const file = logFile();
    if (!file.exists || file.size > MAX_CACHE_BYTES) return entries;
    const parsed: unknown = JSON.parse(file.textSync());
    if (!Array.isArray(parsed)) return entries;
    for (const row of parsed.slice(-MAX_ENTRIES)) {
      if (!Array.isArray(row) || row.length < 2 || row.length > 3) continue;
      const [when, name, code] = row;
      if (!Number.isSafeInteger(when) || when < 0 || when > 8.64e15 || typeof name !== "string" || !allowed.has(name)) continue;
      const event = name as Event;
      if (row.length === 2) entries.push([when, event]);
      else if (isMediaStatus(event, code)) entries.push([when, event, code]);
    }
  } catch { /* A missing or damaged cache must never stop the app. */ }
  return entries;
}

// Explicit operational events only: no raw console output, exceptions, request
// details, credentials, filenames, IDs, saved content, or device identifiers.
export function recordAppEvent(event: Event, httpStatus?: number): void {
  if (!allowed.has(event)) return;
  const rows = getEntries();
  rows.push(isMediaStatus(event, httpStatus) ? [Date.now(), event, httpStatus] : [Date.now(), event]);
  if (rows.length > MAX_ENTRIES) rows.shift();
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(rows));
  } catch { /* The current process can still export its in-memory history. */ }
}

export function formatAppLog(): string {
  const lines = getEntries().map(([when, event, code]) =>
    `${new Date(when).toISOString()}  ${event}${code === undefined ? "" : `  HTTP ${code}`}`);
  return lines.length ? lines.join("\n") + "\n" : "No app events recorded.\n";
}
