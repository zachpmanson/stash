import sharp from "sharp";
export function pngChunk(type, data) {
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([Buffer.from(type), data])) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const output = Buffer.alloc(data.length + 12); output.writeUInt32BE(data.length); output.write(type, 4);
  data.copy(output, 8); output.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8); return output;
}
const chunk = pngChunk;
export async function syntheticPng({ animation = false, excessiveChunks = false, extraChunks } = {}) {
  const original = await sharp({ create: { width: 1, height: 1, channels: 3, background: "red" } }).png().toBuffer();
  const chunks = [];
  for (let offset = 8; offset < original.length;) {
    const size = original.readUInt32BE(offset); chunks.push(original.subarray(offset, offset + size + 12)); offset += size + 12;
  }
  const ihdr = chunks.find(c => c.toString("ascii", 4, 8) === "IHDR");
  const idat = chunks.filter(c => c.toString("ascii", 4, 8) === "IDAT");
  if (excessiveChunks || extraChunks !== undefined) return Buffer.concat([original.subarray(0, 8), ihdr, ...Array.from({ length: extraChunks ?? 4097 }, () => chunk("vpAg", Buffer.from("synthetic acTL payload, not a chunk header"))), ...idat, chunk("IEND", Buffer.alloc(0))]);
  if (!animation) return original;
  const actl = Buffer.alloc(8); actl.writeUInt32BE(2);
  const control = sequence => {
    const data = Buffer.alloc(26); data.writeUInt32BE(sequence); data.writeUInt32BE(1, 4); data.writeUInt32BE(1, 8);
    data.writeUInt16BE(1, 20); data.writeUInt16BE(10, 22); return chunk("fcTL", data);
  };
  const second = Buffer.concat([Buffer.from([0, 0, 0, 2]), ...idat.map(c => c.subarray(8, -4))]);
  return Buffer.concat([original.subarray(0, 8), ihdr, chunk("acTL", actl), control(0), ...idat, control(1), chunk("fdAT", second), chunk("IEND", Buffer.alloc(0))]);
}
