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
const IMAGE_FAILURES = {
  "status-request": "request-failed",
  "status-response": "invalid-response",
  "local-read": "file-read-failed",
  "local-hash": "hash-failed",
  "upload-request": "request-failed",
  "upload-response": "response-failed",
  "download-request": "request-failed",
  "download-read": "stream-failed",
  "local-write": "file-write-failed",
  "verify": "verification-failed",
  "queue-update": "database-error",
} as const;
export type ImageTransferStage = keyof typeof IMAGE_FAILURES;
type ImageEvent = "image.upload_failed" | "image.download_failed";
type ImageReason = typeof IMAGE_FAILURES[ImageTransferStage] | "timeout" | "http-error";
type Entry = [number, Event] | [number, ImageEvent, number] |
  [number, ImageEvent, ImageTransferStage, ImageReason, number?];
const allowed = new Set<string>(EVENTS);
const MAX_ENTRIES = 200;
const MAX_CACHE_BYTES = 24 * 1024;
let entries: Entry[] | undefined;

function isImageEvent(event: Event): event is ImageEvent {
  return event === "image.upload_failed" || event === "image.download_failed";
}

function isHttpStatus(code: unknown): code is number {
  return typeof code === "number" && Number.isInteger(code) && code >= 100 && code <= 599;
}

function isStage(stage: unknown): stage is ImageTransferStage {
  return typeof stage === "string" && Object.hasOwn(IMAGE_FAILURES, stage);
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
      if (!Array.isArray(row) || row.length < 2 || row.length > 5) continue;
      const [when, name, detail, reason, code] = row;
      if (!Number.isSafeInteger(when) || when < 0 || when > 8.64e15 || typeof name !== "string" || !allowed.has(name)) continue;
      const event = name as Event;
      if (row.length === 2) entries.push([when, event]);
      else if (isImageEvent(event)) {
        if (row.length === 3 && isHttpStatus(detail)) entries.push([when, event, detail]);
        else if (isStage(detail)) {
          if (row.length === 4 && (reason === IMAGE_FAILURES[detail] || reason === "timeout"))
            entries.push([when, event, detail, reason]);
          else if (row.length === 5 && reason === "http-error" && isHttpStatus(code))
            entries.push([when, event, detail, reason, code]);
        }
      }
    }
  } catch { /* A missing or damaged cache must never stop the app. */ }
  return entries;
}

// Explicit operational events only: no raw console output, exceptions, request
// details, credentials, filenames, IDs, saved content, or device identifiers.
export function recordAppEvent(event: Event): void {
  if (allowed.has(event)) append([Date.now(), event]);
}

export function recordImageFailure(event: ImageEvent, stage: ImageTransferStage, timedOut: boolean, httpStatus?: number): void {
  if (!isImageEvent(event) || !isStage(stage)) return;
  if (isHttpStatus(httpStatus)) append([Date.now(), event, stage, "http-error", httpStatus]);
  else append([Date.now(), event, stage, timedOut === true ? "timeout" : IMAGE_FAILURES[stage]]);
}

function append(entry: Entry): void {
  const rows = getEntries();
  rows.push(entry);
  if (rows.length > MAX_ENTRIES) rows.shift();
  try {
    const file = logFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify(rows));
  } catch { /* The current process can still export its in-memory history. */ }
}

export function formatAppLog(): string {
  const lines = getEntries().map(([when, event, detail, reason, code]) => {
    const suffix = typeof detail === "number" ? `  HTTP ${detail}` : detail === undefined ? "" :
      `  stage=${detail}  reason=${reason}${code === undefined ? "" : `  HTTP ${code}`}`;
    return `${new Date(when).toISOString()}  ${event}${suffix}`;
  });
  return lines.length ? lines.join("\n") + "\n" : "No app events recorded.\n";
}
