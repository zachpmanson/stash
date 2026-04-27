import { ResolvedSharePayload } from "expo-sharing";
import { Directory, File, Paths } from "expo-file-system";
import { saveItem } from "../db/items";
import { ItemType, StashItem } from "../types";
import { copyFileToStash, getExtension, isImageMime, isVideoMime } from "./fileUtils";
import { fetchLinkPreview } from "./linkPreview";
import { fetchArticle } from "./readability";

export function detectItemType(payload: ResolvedSharePayload): ItemType {
  if (payload.shareType === "url") return "url";
  if (payload.shareType === "text") return "text";
  const mimeType = payload.contentMimeType ?? payload.mimeType ?? "";
  if (isImageMime(mimeType)) return "image";
  if (isVideoMime(mimeType)) return "file";
  return "file";
}

export async function processAndSaveShare(payload: ResolvedSharePayload, folderIds: string[]): Promise<StashItem> {
  const type = detectItemType(payload);
  const id = String(Date.now());
  const now = Date.now();

  let uri: string;
  let mimeType: string;

  if (payload.shareType === "url" || payload.shareType === "text") {
    uri = payload.value;
    mimeType = "text/plain";
  } else {
    uri = payload.contentUri!;
    mimeType = payload.contentMimeType ?? payload.mimeType ?? "application/octet-stream";
  }

  let title: string | null = null;
  let description: string | null = null;
  let faviconUrl: string | null = null;
  let thumbnailPath: string | null = null;
  let articleText: string | null = null;

  if (type === "image" || type === "file") {
    const ext = getExtension(mimeType);
    const filename = `${id}.${ext}`;
    const savedUri = await copyFileToStash(uri, filename);
    if (type === "image") {
      thumbnailPath = savedUri;
    }
    uri = savedUri;
  } else if (type === "url") {
    uri = uri.trim();
    const preview = await fetchLinkPreview(uri);
    title = preview.title;
    description = preview.description;
    faviconUrl = preview.favicon;
    try {
      const article = await fetchArticle(uri);
      articleText = article.text;
    } catch {
      // article extraction is best-effort
    }
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
    article_text: articleText,
    folder_ids: folderIds,
  };

  await saveItem(item, folderIds);
  return { ...item, archived_at: null };
}
