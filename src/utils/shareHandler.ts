import { ShareIntent } from "expo-share-intent";
import { Directory, File, Paths } from "expo-file-system";
import { saveItem } from "../db/items";
import { ItemType, StashItem } from "../types";
import { copyFileToStash, getExtension, isImageMime, isVideoMime } from "./fileUtils";
import { fetchLinkPreview } from "./linkPreview";

export function detectItemType(intent: ShareIntent): ItemType {
  if (intent.type === "weburl") return "url";
  if (intent.type === "text") return "text";
  const mimeType = intent.files?.[0]?.mimeType ?? "";
  if (isImageMime(mimeType)) return "image";
  if (isVideoMime(mimeType)) return "file";
  return "file";
}

export async function processAndSaveShare(intent: ShareIntent, folderIds: string[]): Promise<StashItem> {
  const type = detectItemType(intent);
  const id = String(Date.now());
  const now = Date.now();

  let uri: string;
  let mimeType: string;

  if (intent.type === "weburl") {
    uri = intent.webUrl!;
    mimeType = "text/plain";
  } else if (intent.type === "text") {
    uri = intent.text!;
    mimeType = "text/plain";
  } else {
    const file = intent.files![0];
    uri = file.path;
    mimeType = file.mimeType;
  }

  let title: string | null = null;
  let description: string | null = null;
  let faviconUrl: string | null = null;
  let thumbnailPath: string | null = null;

  if (type === "image" || type === "file") {
    const ext = getExtension(mimeType);
    const filename = `${id}.${ext}`;
    const savedUri = await copyFileToStash(uri, filename);
    if (type === "image") {
      thumbnailPath = savedUri;
    }
    uri = savedUri;
  } else if (type === "url") {
    const preview = await fetchLinkPreview(uri.trim());
    title = preview.title;
    description = preview.description;
    faviconUrl = preview.favicon;
    if (preview.image) {
      try {
        const dir = new Directory(Paths.cache, "stash");
        dir.create({ intermediates: true });
        const thumbDest = new File(dir, `thumb_${id}.jpg`);
        const downloaded = await File.downloadFileAsync(preview.image, thumbDest, { idempotent: true });
        thumbnailPath = downloaded.uri;
      } catch {
        // non-critical
      }
    }
  }

  const item: Omit<StashItem, "archived_at"> = {
    id,
    type,
    uri,
    title,
    description,
    favicon_url: faviconUrl,
    thumbnail_path: thumbnailPath,
    mime_type: mimeType,
    created_at: now,
    folder_ids: folderIds,
  };

  await saveItem(item, folderIds);
  return { ...item, archived_at: null };
}
