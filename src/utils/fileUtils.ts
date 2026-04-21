import { Directory, File, Paths } from "expo-file-system";

const stashDir = new Directory(Paths.document, "stash");

export async function copyFileToStash(uri: string, filename: string): Promise<string> {
  stashDir.create({ intermediates: true, idempotent: true });
  const source = new File(uri);
  const dest = new File(stashDir, filename);
  source.copy(dest);
  return dest.uri;
}
export async function deleteStashFile(fileUri: string): Promise<void> {
  try {
    const file = new File(fileUri);
    const info = await file.info();

    if (info.exists) {
      await file.delete(); // already idempotent in practice
    }
  } catch {
    // ignore
  }
}

export function getExtension(mimeType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
    "application/pdf": "pdf",
    "text/plain": "txt",
  };
  return map[mimeType] ?? "bin";
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isVideoMime(mimeType: string): boolean {
  return mimeType.startsWith("video/");
}

export function isUrl(text: string): boolean {
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
