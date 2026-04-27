import { File } from "expo-file-system";
import exifr from "exifr";

export type ImageGeo = { latitude: number; longitude: number };

export async function readImageGeo(uri: string): Promise<ImageGeo | null> {
  try {
    const buf = await new File(uri).arrayBuffer();
    const gps = await exifr.gps(buf);
    if (!gps || typeof gps.latitude !== "number" || typeof gps.longitude !== "number") return null;
    return { latitude: gps.latitude, longitude: gps.longitude };
  } catch {
    return null;
  }
}

export function mapsUrl(geo: ImageGeo): string {
  return `https://www.google.com/maps/search/?api=1&query=${geo.latitude},${geo.longitude}`;
}
