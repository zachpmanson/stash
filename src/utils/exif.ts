import { File } from "expo-file-system";

export type GpsPoint = { lat: number; lng: number };

/**
 * Minimal JPEG EXIF GPS reader (no dependencies).
 *
 * Walks the JPEG segment table looking for the APP1 "Exif\0\0" block, parses
 * the TIFF header, follows IFD0 → GPSInfo (0x8825), and reads latitude/
 * longitude rationals. Returns null for anything unreadable or GPS-less.
 */
export async function readExifGps(imageFile: File): Promise<GpsPoint | null> {
  try {
    return parseJpegGps(imageFile.bytesSync());
  } catch {
    return null;
  }
}

function parseJpegGps(bytes: Uint8Array): GpsPoint | null {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null; // not a JPEG (e.g. PNG/HEIC) — caller falls back to device GPS
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // Walk JPEG segments looking for APP1 ("Exif\0\0").
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    // Skip padding 0xFF bytes before the marker.
    while (bytes[offset] === 0xff && offset < bytes.length) offset++;
    if (offset + 1 >= bytes.length) return null;
    const marker = bytes[offset++];
    // Standalone markers (no length field) — keep scanning.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;

    const segLen = view.getUint16(offset); // includes the 2 length bytes
    offset += 2;
    if (offset + segLen > bytes.length) return null;

    if (marker === 0xe1) {
      // APP1: check for "Exif\0\0" prefix.
      const prefix = bytes[offset];
      if (
        segLen >= 8 &&
        prefix === 0x45 && // 'E'
        bytes[offset + 1] === 0x78 && // 'x'
        bytes[offset + 2] === 0x69 && // 'i'
        bytes[offset + 3] === 0x66 && // 'f'
        bytes[offset + 4] === 0x00 &&
        bytes[offset + 5] === 0x00
      ) {
        const gps = parseTiffGps(view, offset + 6);
        if (gps) return gps;
      }
    }

    offset += segLen - 2;
  }
  return null;
}

function parseTiffGps(view: DataView, tiffStart: number): GpsPoint | null {
  if (tiffStart + 8 > view.byteLength) return null;

  let le: boolean;
  const endian = view.getUint16(tiffStart);
  if (endian === 0x4949) le = true; // "II"
  else if (endian === 0x4d4d) le = false; // "MM"
  else return null;

  if (view.getUint16(tiffStart + 2, le) !== 42) return null;
  const ifd0Offset = view.getUint32(tiffStart + 4, le);
  if (ifd0Offset + 2 > view.byteLength) return null;

  const getU16 = (pos: number) => view.getUint16(pos, le);
  const getU32 = (pos: number) => view.getUint32(pos, le);

  // Walk IFD0 entries for the GPSInfo tag (0x8825).
  let pos = tiffStart + ifd0Offset;
  const entryCount = getU16(pos);
  pos += 2;
  for (let i = 0; i < entryCount; i++) {
    const entry = pos + i * 12;
    if (entry + 12 > view.byteLength) return null;
    if (getU16(entry) === 0x8825) {
      const gpsOffset = getU32(entry + 8);
      if (gpsOffset === 0) return null;
      return parseGpsIfd(view, tiffStart + gpsOffset, getU16, getU32, tiffStart);
    }
  }
  return null;
}

function parseGpsIfd(
  view: DataView,
  ifdStart: number,
  getU16: (pos: number) => number,
  getU32: (pos: number) => number,
  tiffStart: number,
): GpsPoint | null {
  if (ifdStart + 2 > view.byteLength) return null;
  const entryCount = getU16(ifdStart);

  let latRef = "";
  let lngRef = "";
  let latRat: number[] | null = null;
  let lngRat: number[] | null = null;

  for (let i = 0; i < entryCount; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > view.byteLength) return null;
    const tag = getU16(entry);
    const type = getU16(entry + 2);
    const count = getU32(entry + 4);
    const valuePos = entry + 8;

    if (tag === 1 && type === 2 && count === 2) {
      // GPSLatitudeRef: ASCII "N"/"S"
      const c = view.getUint8(valuePos);
      latRef = String.fromCharCode(c);
    } else if (tag === 3 && type === 2 && count === 2) {
      const c = view.getUint8(valuePos);
      lngRef = String.fromCharCode(c);
    } else if ((tag === 2 || tag === 4) && type === 5 && count === 3) {
      // GPSLatitude/GPSLongitude: 3 RATIONALs (deg, min, sec).
      // If the value fits in 4 bytes it's inline, else it's an offset.
      const dataOffset = typeSize(type) * count <= 4 ? valuePos : tiffStart + getU32(valuePos);
      const deg = readRational(view, dataOffset, getU32);
      const min = readRational(view, dataOffset + 8, getU32);
      const sec = readRational(view, dataOffset + 16, getU32);
      if (deg === null || min === null || sec === null) continue;
      const decimal = deg + min / 60 + sec / 3600;
      if (tag === 2) latRat = [decimal];
      else lngRat = [decimal];
    }
  }

  if (latRat && lngRat) {
    let lat = latRat[0];
    let lng = lngRat[0];
    if (latRef === "S") lat = -lat;
    if (lngRef === "W") lng = -lng;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  }
  return null;
}

function readRational(
  view: DataView,
  pos: number,
  getU32: (p: number) => number,
): number | null {
  if (pos + 8 > view.byteLength) return null;
  const num = getU32(pos);
  const den = getU32(pos + 4);
  if (den === 0) return null;
  return num / den;
}

function typeSize(type: number): number {
  switch (type) {
    case 1: return 1; // BYTE
    case 2: return 1; // ASCII
    case 3: return 2; // SHORT
    case 4: return 4; // LONG
    case 5: return 8; // RATIONAL
    case 7: return 1; // UNDEFINED
    default: return 4;
  }
}