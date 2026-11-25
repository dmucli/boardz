// How big a printed QR code's quiet zone is, in millimetres, before it renders.
//
// The board poster lines the code's DARK modules up with the text and photo
// edges beside it, so the white 4-module quiet zone hangs into the page margin
// (blank paper either way). That offset is `box × 4 / (modules + 8)`, and the
// module count depends on how long the encoded URL is. The sheet is
// server-rendered CSS, so the count has to be known on the server, without
// drawing the code.
//
// `qrcode.react` (the renderer `PosterQr` uses) exports no way to ask. What it
// does is fixed by the QR standard: a URL always holds lowercase letters, so it
// is one byte-mode segment, and the smallest version whose byte capacity at
// error correction Q holds it is the version drawn. The table below is that
// capacity, version 1 to 40. `qr-geometry.test.tsx` renders `qrcode.react` at
// every length up to 300 bytes and checks this answer against the SVG it draws,
// so the two cannot drift apart silently.

/** Byte-mode capacity at error correction Q, versions 1–40 (ISO/IEC 18004 table 7). */
const BYTE_CAPACITY_AT_Q = [
  11, 20, 32, 46, 60, 74, 86, 108, 130, 151, 177, 203, 241, 258, 292, 322, 364, 394, 442, 482, 509, 565, 611, 661, 715,
  751, 805, 868, 908, 982, 1030, 1112, 1168, 1228, 1283, 1351, 1423, 1499, 1579, 1663,
] as const;

/** The spec quiet zone, in modules, on every side. */
export const QR_QUIET_ZONE_MODULES = 4;

/**
 * Modules per side of the code `qrcode.react` draws for `text` at level Q,
 * without the quiet zone. `null` when the text is too long for any version.
 */
export function qrModuleCount(text: string): number | null {
  const byteLength = new TextEncoder().encode(text).length;
  const versionIndex = BYTE_CAPACITY_AT_Q.findIndex((capacity) => byteLength <= capacity);
  if (versionIndex === -1) return null;
  const version = versionIndex + 1;
  return 17 + 4 * version;
}

/**
 * The width of the white quiet zone, in millimetres, when the code for `text`
 * (quiet zone included) is printed `boxMm` wide. Zero for text no code holds,
 * which `PosterQr` cannot draw either.
 */
export function qrQuietZoneMm(text: string, boxMm: number): number {
  const modules = qrModuleCount(text);
  if (modules === null) return 0;
  return (boxMm * QR_QUIET_ZONE_MODULES) / (modules + 2 * QR_QUIET_ZONE_MODULES);
}
