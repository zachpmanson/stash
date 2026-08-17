declare module "exifr/dist/mini.esm.mjs" {
  export function gps(
    input: Uint8Array | ArrayBuffer | DataView,
  ): Promise<{ latitude: number; longitude: number } | undefined>;
}
