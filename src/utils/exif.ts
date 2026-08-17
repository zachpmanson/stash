// Import the static "mini" build directly — the default "full" build uses
// dynamic import() for lazy-loaded parsers, which Hermes can't bundle.
import { gps } from "exifr/dist/mini.esm.mjs";
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
    const gpsData = await gps(bytes);
    if (
      gpsData &&
      typeof gpsData.latitude === "number" &&
      typeof gpsData.longitude === "number" &&
      Number.isFinite(gpsData.latitude) &&
      Number.isFinite(gpsData.longitude)
    ) {
      return { lat: gpsData.latitude, lng: gpsData.longitude };
    }
  } catch {
    // unsupported format or unreadable — no GPS
  }
  return null;
}
