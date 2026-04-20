import { Directory, File, Paths } from "expo-file-system";
import { saveItem } from "../db/items";
import { ItemType, ShareData, StashItem } from "../types";
import { copyFileToStash, getExtension, isImageMime, isUrl, isVideoMime } from "./fileUtils";
import { fetchLinkPreview } from "./linkPreview";

export function detectItemType(mimeType: string, data: string): ItemType {
  if (isImageMime(mimeType)) return "image";
  if (isVideoMime(mimeType)) return "file";
  if (mimeType === "text/plain" && isUrl(data)) return "url";
  if (mimeType.startsWith("text/")) return "text";
  return "file";
}

export async function processAndSaveShare(shareData: ShareData, folderIds: string[]): Promise<StashItem> {
  const { mimeType, data } = shareData;
  const type = detectItemType(mimeType, data);
  const id = String(Date.now());
  const now = Date.now();

  let uri = data;
  let title: string | null = null;
  let description: string | null = null;
  let faviconUrl: string | null = null;
  let thumbnailPath: string | null = null;
  if (type === "image" || type === "file") {
    const ext = getExtension(mimeType);
    const filename = `${id}.${ext}`;
    uri = await copyFileToStash(data, filename);
    if (type === "image") {
      thumbnailPath = uri;
    }
  } else if (type === "url") {
    const preview = await fetchLinkPreview(data.trim());
    title = preview.title;
    description = preview.description;
    faviconUrl = preview.favicon;
    // Cache the preview image locally if available
    if (preview.image) {
      try {
        const imgExt = "jpg";
        const imgFilename = `thumb_${id}.${imgExt}`;
        const dir = new Directory(Paths.cache, "stash");
        dir.create({ intermediates: true });

        const file = await File.downloadFileAsync(preview.image, dir);
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
