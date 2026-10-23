import { File, Directory, Paths } from "expo-file-system";
import { fetch as nativeFetch } from "expo/fetch";
import * as Crypto from "expo-crypto";
import { randomId } from "../utils/randomId";

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export type ImageDescriptor = { sha256: string; bytes: number; mime: string };
export class MediaTransferError extends Error {
  constructor(message: string, public status = 0) { super(message); }
}
export const localImageExists = (uri: string): boolean => {
  try { return uri.startsWith("file:") && new File(uri).exists; } catch { return false; }
};
async function imageBytes(file: File): Promise<Uint8Array<ArrayBuffer>> {
  if (!file.exists || file.size <= 0 || file.size > MAX_IMAGE_BYTES)
    throw new MediaTransferError("Local image is unavailable or exceeds 20 MiB", 413);
  const bytes = await file.bytes();
  if (bytes.length !== file.size || bytes.length > MAX_IMAGE_BYTES) throw new MediaTransferError("Image changed while reading", 409);
  return bytes;
}
async function digestBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return Array.from(new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function imageDigest(file: File): Promise<string> { return digestBytes(await imageBytes(file)); }
export async function uploadLocalImage(uri: string, url: string, authorization: string, signal: AbortSignal): Promise<void> {
  const bytes = await imageBytes(new File(uri)); const sha = await digestBytes(bytes);
  if (signal.aborted) throw new MediaTransferError("Image transfer cancelled");
  const response = await nativeFetch(url, { method: "PUT", redirect: "error", signal,
    headers: { Authorization: authorization, "Content-Type": "application/octet-stream", "X-Stash-Request": "1", "X-Stash-Content-SHA256": sha },
    // Expo normalizes File/Blob bodies by overriding Content-Type with File.type.
    // A bounded byte view preserves our non-simple octet-stream contract and
    // sends exactly the bytes just hashed (no second read/file-change race).
    body: bytes });
  // Never put remote response bodies/paths/credentials into durable queue errors.
  if (!response.ok) { await response.body?.cancel(); throw new MediaTransferError(`Image upload HTTP ${response.status}`, response.status); }
  await response.body?.cancel();
}
export async function downloadPrivateImage(url: string, value: ImageDescriptor, authorization: string, signal: AbortSignal): Promise<string> {
  if (!/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MAX_IMAGE_BYTES ||
    !["image/jpeg", "image/png", "image/webp"].includes(value.mime)) throw new MediaTransferError("Unsupported private image descriptor", 415);
  const directory = new Directory(Paths.document, "stash");
  directory.create({ intermediates: true, idempotent: true });
  const destination = new File(directory, `synced-${value.sha256}.image`);
  if (destination.exists) {
    if (destination.size !== value.bytes || await imageDigest(destination) !== value.sha256) throw new MediaTransferError("Retained local image failed verification; recovery required", 409);
    return destination.uri;
  }
  const temporary = new File(directory, `${randomId()}.partial`);
  let promoted = false;
  try {
    const response = await nativeFetch(url, { headers: { Authorization: authorization, "X-Stash-Request": "1" }, signal, redirect: "error" });
    if (!response.ok) { await response.body?.cancel(); throw new MediaTransferError(`Image download HTTP ${response.status}`, response.status); }
    if (response.headers.get("X-Stash-Content-SHA256") !== value.sha256 || response.headers.get("Content-Type") !== value.mime ||
      Number(response.headers.get("Content-Length")) !== value.bytes || !response.body) {
      await response.body?.cancel(); throw new MediaTransferError("Image download descriptor mismatch", 422);
    }
    temporary.create();
    const output = temporary.open(); const reader = response.body.getReader(); let size = 0;
    try {
      while (true) {
        if (signal.aborted) throw new MediaTransferError("Image transfer cancelled");
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > value.bytes || size > MAX_IMAGE_BYTES) throw new MediaTransferError("Image download exceeds its declared limit", 413);
        output.writeBytes(chunk.value);
      }
      if (size !== value.bytes) throw new MediaTransferError("Image download interrupted", 422);
    } finally { output.close(); await reader.cancel().catch(() => {}); }
    if (signal.aborted || await imageDigest(temporary) !== value.sha256) throw new MediaTransferError("Image download failed SHA-256 verification", 422);
    // Same-directory native rename; no DB path is published before verification.
    // The serial worker owns this destination and never overwrites phone imports.
    temporary.move(destination); promoted = true;
    return destination.uri;
  } finally {
    if (!promoted && temporary.exists) temporary.delete(); // this attempt's partial only
  }
}
