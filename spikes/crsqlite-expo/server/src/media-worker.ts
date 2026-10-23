import sharp from "sharp";
import { MEDIA_MAX_EDGE, MEDIA_MAX_PIXELS } from "./media-store.js";

sharp.cache(false);
sharp.concurrency(1);
const [input, preview, thumbnail] = process.argv.slice(2);
try {
  const options = { limitInputPixels: MEDIA_MAX_PIXELS, failOn: "warning" as const, sequentialRead: true };
  const meta = await sharp(input, options).metadata();
  const mime = ({ jpeg: "image/jpeg", png: "image/png", webp: "image/webp" } as Record<string, string>)[meta.format ?? ""];
  if (!mime || !meta.width || !meta.height || meta.width > MEDIA_MAX_EDGE || meta.height > MEDIA_MAX_EDGE ||
    meta.width * meta.height > MEDIA_MAX_PIXELS || (meta.pages ?? 1) !== 1)
    throw new Error("Unsupported format, animation or dimensions");
  // Decode the complete raster before deriving previews: a valid header is not
  // proof the original is decodable. Pixel count bounds this intermediate.
  const { data, info } = await sharp(input, options).rotate().raw().toBuffer({ resolveWithObject: true });
  for (const [output, edge] of [[preview, 1600], [thumbnail, 384]] as const) {
    await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" }).jpeg({ quality: 80 }).toFile(output);
  }
  process.send?.({ ok: true, mime, width: meta.width, height: meta.height, peakRssKiB: process.resourceUsage().maxRSS });
} catch { process.send?.({ ok: false }); process.exitCode = 1; }
process.disconnect?.();
