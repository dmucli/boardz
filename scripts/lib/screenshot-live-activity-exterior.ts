/// <reference types="node" />
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface LiveActivityExterior {
  method: 'edge-connected-native-exterior-alpha';
  maxBackgroundRed: 3;
  borderGuardPixels: 1;
  transparentPixels: number;
  nativeCropSha256: string;
  alphaSha256: string;
}

/**
 * These four reviewed iPhone 13 Pro cards have the same measured glass outline.
 * Only dark wallpaper connected to the crop's exterior is removed. The one-pixel
 * guard retains mixed/antialiased native border pixels. RGB is never rewritten.
 */
export async function extractLiveActivityExterior(
  source: Buffer,
): Promise<{ pixels: Buffer; extraction: LiveActivityExterior }> {
  const metadata = await sharp(source).metadata();
  if (metadata.format !== 'png' || metadata.width !== 1110 || metadata.height !== 435 || metadata.hasProfile)
    throw new Error(
      'Live Activity exterior requires the reviewed 1110×435 sRGB native card; measure and review a new outline locally.',
    );
  const { data: nativePixels, info } = await sharp(source).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  if (channels !== 3) throw new Error('Unsupported native Live Activity pixel format');
  const background = (index: number) => nativePixels[index * channels] <= 3;
  const exterior = new Uint8Array(width * height);
  const queue = new Int32Array(exterior.length);
  let queued = 0;
  const enqueue = (index: number) => {
    if (!exterior[index] && background(index)) {
      exterior[index] = 1;
      queue[queued++] = index;
    }
  };
  for (let column = 0; column < width; column++) {
    enqueue(column);
    enqueue((height - 1) * width + column);
  }
  for (let row = 0; row < height; row++) {
    enqueue(row * width);
    enqueue(row * width + width - 1);
  }
  for (let cursor = 0; cursor < queued; cursor++) {
    const index = queue[cursor];
    const column = index % width;
    for (const neighbor of [
      column ? index - 1 : -1,
      column < width - 1 ? index + 1 : -1,
      index - width,
      index + width,
    ]) {
      if (neighbor >= 0 && neighbor < exterior.length) enqueue(neighbor);
    }
  }
  const alpha = new Uint8Array(exterior.length).fill(255);
  let transparentPixels = 0;
  for (let index = 0; index < exterior.length; index++) {
    if (!exterior[index]) continue;
    const row = Math.floor(index / width);
    const column = index % width;
    let nativeBorderNeighbor = false;
    for (let offsetY = -1; offsetY <= 1; offsetY++)
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const neighborX = column + offsetX;
        const neighborY = row + offsetY;
        if (
          neighborX >= 0 &&
          neighborX < width &&
          neighborY >= 0 &&
          neighborY < height &&
          !exterior[neighborY * width + neighborX]
        )
          nativeBorderNeighbor = true;
      }
    if (!nativeBorderNeighbor) {
      alpha[index] = 0;
      transparentPixels++;
    }
  }
  // Reject blank crops, a breached card surface and unsupported silhouettes.
  if (
    transparentPixels < 2000 ||
    transparentPixels > 40000 ||
    [0, width - 1, (height - 1) * width, width * height - 1].some((index) => alpha[index] !== 0)
  )
    throw new Error('Native Live Activity exterior outline does not match the reviewed captures');
  for (let row = 0; row < height; row++) {
    const line = alpha.subarray(row * width, (row + 1) * width);
    const left = line.indexOf(255);
    const right = line.lastIndexOf(255);
    if (left < 0) {
      if (row > 1 && row < height - 2) throw new Error('Native Live Activity contour is incomplete');
      continue;
    }
    if (right - left < width * 0.7 || line.subarray(left, right + 1).some((opacity) => opacity !== 255))
      throw new Error('Native Live Activity exterior mask would remove interior pixels');
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let index = 0; index < alpha.length; index++) {
    nativePixels.copy(pixels, index * 4, index * 3, index * 3 + 3);
    pixels[index * 4 + 3] = alpha[index];
  }
  return {
    pixels: await sharp(pixels, { raw: { width, height, channels: 4 } })
      .png()
      .toBuffer(),
    extraction: {
      method: 'edge-connected-native-exterior-alpha',
      maxBackgroundRed: 3,
      borderGuardPixels: 1,
      transparentPixels,
      nativeCropSha256: createHash('sha256').update(source).digest('hex'),
      alphaSha256: createHash('sha256').update(alpha).digest('hex'),
    },
  };
}
