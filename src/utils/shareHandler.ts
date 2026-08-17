import { ResolvedSharePayload } from "expo-sharing";
import * as Location from "expo-location";
import { Directory, File, Paths } from "expo-file-system";
import { saveItem } from "../db/items";
import { ItemType, StashItem } from "../types";
import { copyFileToStash, getExtension, isImageMime, isVideoMime } from "./fileUtils";
import { readExifGps, GpsPoint } from "./exif";
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

type CoreInput = {
  type: ItemType;
  // For url/text: the literal value. For image/file: the source uri to copy.
  source: string;
  mimeType: string;
  /** When true, try to capture a GPS location (EXIF first, device GPS fallback). */
  captureLocation?: boolean;
};

async function saveCore({ type, source, mimeType, captureLocation }: CoreInput, folderIds: string[]): Promise<StashItem> {
  const id = String(Date.now());
  const now = Date.now();

  let uri = source;
  let title: string | null = null;
  let description: string | null = null;
  let faviconUrl: string | null = null;
  let thumbnailPath: string | null = null;
  let articleHtml: string | null = null;
  let recipeJson: string | null = null;
  let lat: number | null = null;
  let lng: number | null = null;

  if (type === "image" || type === "file") {
    const ext = getExtension(mimeType);
    const filename = `${id}.${ext}`;
    const savedUri = await copyFileToStash(source, filename);
    if (type === "image") {
      thumbnailPath = savedUri;
    }
    uri = savedUri;
    if (captureLocation) {
      const gps = await captureLocationForImage(savedUri);
      if (gps) {
        lat = gps.lat;
        lng = gps.lng;
      }
    }
  } else if (type === "url") {
    uri = uri.trim();
    const preview = await fetchLinkPreview(uri);
    title = preview.title;
    description = preview.description;
    faviconUrl = preview.favicon;
    try {
      const article = await fetchArticle(uri);
      articleHtml = article.html;
      if (article.recipe) recipeJson = JSON.stringify(article.recipe);
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
    article_text: null,
    article_html: articleHtml,
    recipe_json: recipeJson,
    lat,
    lng,
    folder_ids: folderIds,
  };

  await saveItem(item, folderIds);
  return { ...item, archived_at: null };
}

export async function processAndSaveShare(payload: ResolvedSharePayload, folderIds: string[], options?: { captureLocation?: boolean }): Promise<StashItem> {
  const type = detectItemType(payload);
  let source: string;
  let mimeType: string;

  if (payload.shareType === "url" || payload.shareType === "text") {
    source = payload.value;
    mimeType = "text/plain";
  } else {
    source = payload.contentUri!;
    mimeType = payload.contentMimeType ?? payload.mimeType ?? "application/octet-stream";
  }

  return saveCore({ type, source, mimeType, captureLocation: options?.captureLocation }, folderIds);
}

export type ManualPayload = {
  type: "url" | "text";
  value: string;
  captureLocation?: boolean;
} | {
  type: "image";
  localUri: string;
  mimeType: string;
  captureLocation?: boolean;
};

export async function saveManualItem(payload: ManualPayload, folderIds: string[]): Promise<StashItem> {
  if (payload.type === "url") {
    return saveCore({ type: "url", source: payload.value, mimeType: "text/plain" }, folderIds);
  }
  if (payload.type === "text") {
    return saveCore({ type: "text", source: payload.value, mimeType: "text/plain" }, folderIds);
  }
  const imagePayload = payload as Extract<ManualPayload, { type: "image" }>;
  return saveCore(
    { type: "image", source: imagePayload.localUri, mimeType: imagePayload.mimeType, captureLocation: imagePayload.captureLocation },
    folderIds,
  );
}

/**
 * Captures a GPS location for an image: EXIF GPS first, then device GPS
 * (requesting permission) as fallback. Returns null if neither is available
 * or the user denies permission.
 */
async function captureLocationForImage(savedUri: string): Promise<GpsPoint | null> {
  // 1. Try the image's embedded EXIF GPS first — no permission needed.
  try {
    const gps = await readExifGps(new File(savedUri));
    if (gps) return gps;
  } catch {
    // fall through to device GPS
  }

  // 2. Fall back to the device's current position.
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    if (pos && Number.isFinite(pos.coords.latitude) && Number.isFinite(pos.coords.longitude)) {
      return { lat: pos.coords.latitude, lng: pos.coords.longitude };
    }
  } catch {
    // location unavailable
  }
  return null;
}
