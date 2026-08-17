import exifr from "exifr";
import { File } from "expo-file-system";

export type GpsPoint = { lat: number; lng: number };

/**
 * Reads GPS coordinates from an image file's EXIF metadata.
 * Returns null when the image has no location info (or isn't a supported
 * format). JPEG/HEIC/PNG/TIFF are supported.
 */
export async function readExifGps(imageFile: File): Promise<GpsPoint | null> {
  try {
    const bytes = imageFile.bytesSync();
    const gps = await exifr.gps(bytes);
    if (
      gps &&
      typeof gps.latitude === "number" &&
      typeof gps.longitude === "number" &&
      Number.isFinite(gps.latitude) &&
      Number.isFinite(gps.longitude)
    ) {
      return { lat: gps.latitude, lng: gps.longitude };
    }
  } catch {
    // unsupported format or unreadable — no GPS
  }
  return null;
}
