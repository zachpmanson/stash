import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, link, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fork } from "node:child_process";
import type Database from "better-sqlite3";
import { PngPolicyError, requireStillPng } from "./media-png.js";

export const MEDIA_MAX_BYTES = 20 * 1024 * 1024;
export const MEDIA_MAX_PIXELS = 24_000_000;
export const MEDIA_MAX_EDGE = 12000;
export class MediaError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export type Manifest = {
  media_id: string; original_sha: string; preview_sha: string; thumbnail_sha: string;
  size: number; mime: string; width: number; height: number;
};
export function initializeMedia(db: Database.Database): void {
  // Ordinary local tables: never add these to the CR-SQLite schema or clocks.
  db.exec(`CREATE TABLE IF NOT EXISTS stash_media_v1 (
    media_id TEXT PRIMARY KEY NOT NULL, original_sha TEXT NOT NULL,
    preview_sha TEXT NOT NULL, thumbnail_sha TEXT NOT NULL,
    size INTEGER NOT NULL, mime TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS stash_media_uploads_v1 (
    upload_id TEXT PRIMARY KEY NOT NULL, finalized INTEGER NOT NULL DEFAULT 0,
    final_request TEXT, created_at INTEGER NOT NULL
  );`);
}
export function manifest(db: Database.Database, mediaId: string): Manifest | undefined {
  return db.prepare("SELECT * FROM stash_media_v1 WHERE media_id=?").get(mediaId) as Manifest | undefined;
}
export function commitManifest(db: Database.Database, value: Manifest): void {
  const previous = manifest(db, value.media_id);
  if (previous && previous.original_sha !== value.original_sha)
    throw new MediaError(409, "This media ID already has different original bytes");
  if (!previous) db.prepare(`INSERT INTO stash_media_v1
    (media_id,original_sha,preview_sha,thumbnail_sha,size,mime,width,height)
    VALUES (@media_id,@original_sha,@preview_sha,@thumbnail_sha,@size,@mime,@width,@height)`).run(value);
}
export const validDigest = (value: string): boolean => /^[a-f0-9]{64}$/.test(value);
export function blobPath(root: string, digest: string): string {
  if (!validDigest(digest)) throw new Error("Invalid private blob digest");
  return path.join(root, "sha256", digest.slice(0, 2), digest);
}
export async function initializeMediaDirectory(root: string): Promise<void> {
  await makeDirectory(root);
  await makeDirectory(path.join(root, "sha256"));
  await makeDirectory(path.join(root, "temporary"));
}
export async function syncDirectory(directory: string): Promise<void> {
  const fd = await open(directory, "r");
  try { await fd.sync(); } finally { await fd.close(); }
}
async function makeDirectory(directory: string): Promise<void> {
  // Sync parent entries too: fsync(file) alone does not make a newly-created CAS
  // shard durable across a power failure before the manifest transaction.
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await syncDirectory(directory);
  await syncDirectory(path.dirname(directory));
}
export async function verifyBlob(filename: string, expected: string): Promise<number> {
  const hash = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(filename)) { hash.update(chunk); size += chunk.length; }
  if (hash.digest("hex") !== expected) throw new MediaError(503, "Private image integrity check failed");
  return size;
}
async function publish(root: string, temporary: string, sha: string): Promise<void> {
  const destination = blobPath(root, sha);
  await makeDirectory(path.dirname(destination));
  try { await link(temporary, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    // Existing immutable objects must not hide corruption or an interrupted copy.
    await verifyBlob(destination, sha);
  }
  await syncDirectory(path.dirname(destination));
}

// One decoder process/request; bounded parallel work and native decoder pixels.
// The separate process is killed on timeout: worker thread heap limits do not
// bound libvips' native allocations or interrupt a stuck native decode.
let active = 0;
export async function receiveImage(root: string, stream: ReadableStream<Uint8Array> | null, expected: string, signal?: AbortSignal): Promise<Omit<Manifest, "media_id">> {
  if (!validDigest(expected)) throw new MediaError(400, "A lowercase SHA-256 digest is required");
  if (!stream) throw new MediaError(400, "Image bytes required");
  if (active >= 2) throw new MediaError(503, "Image processing busy; retry later");
  active++;
  const temporaryRoot = path.join(root, "temporary");
  const temporary = path.join(temporaryRoot, randomUUID());
  const preview = `${temporary}.preview`; const thumbnail = `${temporary}.thumbnail`;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 30_000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    await initializeMediaDirectory(root);
    const output = await open(temporary, "wx", 0o600);
    const hash = createHash("sha256"); let size = 0;
    reader = stream.getReader();
    const cancelRead = () => { void reader?.cancel().catch(() => {}); };
    controller.signal.addEventListener("abort", cancelRead, { once: true });
    try {
      while (true) {
        if (controller.signal.aborted) throw new MediaError(408, "Image upload timed out or cancelled");
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MEDIA_MAX_BYTES) throw new MediaError(413, "Image exceeds 20 MiB");
        hash.update(value);
        // FileHandle.write may write fewer bytes; writeFile handles partial writes.
        await output.writeFile(value);
      }
      if (controller.signal.aborted) throw new MediaError(408, "Image upload timed out or cancelled");
      if (!size) throw new MediaError(415, "Empty image");
      if (hash.digest("hex") !== expected) throw new MediaError(422, "Image SHA-256 mismatch");
      await output.sync();
    } finally {
      controller.signal.removeEventListener("abort", cancelRead);
      await output.close();
    }
    const dimensions = await decodeImage(temporary, preview, thumbnail, controller.signal);
    const previewSha = await hashAndSync(preview); const thumbnailSha = await hashAndSync(thumbnail);
    // Immutable files become durable before any DB reference. Crashes may leave
    // unreferenced complete blobs, never a manifest pointing to half an upload.
    await publish(root, temporary, expected);
    await publish(root, preview, previewSha);
    await publish(root, thumbnail, thumbnailSha);
    return { original_sha: expected, preview_sha: previewSha, thumbnail_sha: thumbnailSha, size, ...dimensions };
  } finally {
    clearTimeout(timeout); signal?.removeEventListener("abort", abort);
    await reader?.cancel().catch(() => {});
    await Promise.all([temporary, preview, thumbnail].map(file => unlink(file).catch(() => {})));
    active--;
  }
}
async function hashAndSync(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  const fd = await open(filename, "r+");
  try { await fd.chmod(0o600); await fd.sync(); } finally { await fd.close(); }
  return hash.digest("hex");
}
function decodeImage(input: string, preview: string, thumbnail: string, signal: AbortSignal): Promise<{ mime: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const compiled = fileURLToPath(new URL("./media-worker.js", import.meta.url));
    const source = import.meta.url.endsWith(".ts");
    const child = fork(source ? fileURLToPath(new URL("./media-worker.ts", import.meta.url)) : compiled, [input, preview, thumbnail], {
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      execArgv: [...(source ? ["--import", "tsx"] : []), "--max-old-space-size=64"],
      env: { ...process.env, VIPS_CONCURRENCY: "1", MALLOC_ARENA_MAX: "2" },
    });
    let result: { mime: string; width: number; height: number } | undefined;
    let rejected = false;
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(kill, 10_000);
    signal.addEventListener("abort", kill, { once: true });
    if (signal.aborted) kill();
    child.on("message", message => {
      const m = message as { ok?: boolean; mime: string; width: number; height: number };
      if (m.ok) result = { mime: m.mime, width: m.width, height: m.height };
      else rejected = true;
    });
    child.once("error", reject);
    child.once("exit", code => {
      clearTimeout(timer); signal.removeEventListener("abort", kill);
      if (code === 0 && result && !signal.aborted) resolve(result);
      else reject(new MediaError(signal.aborted ? 408 : rejected ? 415 : 422,
        signal.aborted ? "Image upload timed out or cancelled" : "Unsupported, invalid or excessively large image"));
    });
  });
}
export async function mediaFile(root: string, value: Manifest, kind: "original" | "preview" | "thumbnail") {
  const digest = value[`${kind}_sha`];
  const filename = blobPath(root, digest);
  const info = await stat(filename);
  if (!info.isFile() || (kind === "original" && info.size !== value.size))
    throw new MediaError(503, "Private image unavailable; recovery required");
  await verifyBlob(filename, digest);
  if (kind === "original" && value.mime === "image/png") {
    try { await requireStillPng(filename); }
    catch (error) {
      if (error instanceof PngPolicyError) throw new MediaError(415, "Unsupported or animated PNG original; retained bytes were not changed");
      throw error;
    }
  }
  return { filename, digest, size: info.size, mime: kind === "original" ? value.mime : "image/jpeg" };
}
