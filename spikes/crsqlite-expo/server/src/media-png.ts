import { open } from "node:fs/promises";

export class PngPolicyError extends Error {}
export async function requireStillPng(filename: string): Promise<void> {
  // libvips reports APNG as PNG without `pages`; validating only its first frame
  // cannot prove it is still. Scan bounded headers, never decoded frame data.
  const fd = await open(filename, "r");
  try {
    const { size } = await fd.stat();
    const header = Buffer.alloc(8);
    if ((await fd.read(header, 0, 8, 0)).bytesRead !== 8 || !header.equals(Buffer.from([137,80,78,71,13,10,26,10])))
      throw new PngPolicyError("Invalid PNG signature");
    let offset = 8, chunks = 0;
    while (offset + 12 <= size) {
      if (++chunks > 4096) throw new PngPolicyError("PNG metadata complexity exceeds policy");
      if ((await fd.read(header, 0, 8, offset)).bytesRead !== 8) throw new PngPolicyError("Truncated PNG chunk");
      const length = header.readUInt32BE(0);
      if (length > size - offset - 12) throw new PngPolicyError("Invalid PNG chunk length");
      const kind = header.toString("ascii", 4, 8);
      if (["acTL", "fcTL", "fdAT"].includes(kind)) throw new PngPolicyError("Animated PNG is unsupported");
      if (kind === "IEND") return;
      offset += length + 12;
    }
    throw new PngPolicyError("Incomplete PNG structure");
  } finally { await fd.close(); }
}
