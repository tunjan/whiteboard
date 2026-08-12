import { CUSTOM_STICKER_MAX_PX } from '@whiteboard/shared';

/**
 * Background removal for user-uploaded stickers.
 *
 * The cut-out is a flood fill seeded from the image border, not a segmentation
 * model: a sticker source is nearly always flat art on a uniform backdrop, and
 * a corner-seeded fill handles that exactly, instantly, and offline — where a
 * model would cost megabytes of weights fetched at runtime.
 *
 * Flooding from the border (rather than erasing every pixel that matches the
 * backdrop) is what keeps interior detail: a white highlight enclosed by the
 * artwork is never reached, so only the backdrop the subject floats on goes.
 *
 * The pixel functions here are deliberately free of canvas/DOM types so they
 * can be tested directly on a plain array.
 */

/** Alpha at or above this counts as opaque when checking for existing cut-outs. */
const OPAQUE_ALPHA = 250;

/**
 * Share of translucent pixels that means "this PNG is already cut out". A few
 * stray soft pixels are just anti-aliasing; 1% is a real alpha channel.
 */
const ALREADY_CUT_OUT = 0.01;

/**
 * How far a pixel's colour may sit from the sampled backdrop and still be
 * erased, as a fraction of the RGB cube's diagonal. Tuned so JPEG-ish noise and
 * gentle gradients in a backdrop still flood, while flat art next to it holds.
 */
const TOLERANCE = 0.14;

/**
 * Pixels between `TOLERANCE` and `TOLERANCE * FEATHER` from the backdrop are
 * partially erased instead of kept solid — that band is the artwork's
 * anti-aliased rim, and feathering it is what stops the cut-out reading as a
 * jagged paper edge. The band is never flooded through, so it can't leak inside.
 */
const FEATHER = 2;

/**
 * Above this share erased, the sampled key matched the artwork too (a mostly
 * flat image), so the cut-out is abandoned rather than handing back an empty
 * sticker.
 */
const MAX_ERASED = 0.985;

export interface BackgroundRemoval {
  /**
   * Whether pixels were erased. False when the source already carried
   * transparency, or when the fill would have consumed the whole image.
   */
  removed: boolean;
  /** Share of pixels made fully transparent (0–1). */
  erased: number;
}

/** True when the image already has a real alpha channel. */
export function hasTransparency(data: Uint8ClampedArray): boolean {
  const pixels = data.length / 4;
  let soft = 0;
  const needed = Math.max(1, Math.floor(pixels * ALREADY_CUT_OUT));
  for (let p = 0; p < pixels; p++) {
    if (data[p * 4 + 3]! < OPAQUE_ALPHA && ++soft >= needed) return true;
  }
  return false;
}

/**
 * The dominant colour around the image border, averaged over the pixels that
 * share its coarse 16-level-per-channel bucket.
 *
 * The mode rather than a corner pixel or the mean: one corner may land on the
 * artwork, and a mean of two colours is a third colour that matches neither.
 */
export function sampleBackgroundColor(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): [number, number, number] {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const add = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n++;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    if (height > 1) add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    if (width > 1) add(width - 1, y);
  }
  let best = { n: 0, r: 0, g: 0, b: 0 };
  for (const bucket of buckets.values()) {
    if (bucket.n > best.n) best = bucket;
  }
  if (best.n === 0) return [255, 255, 255];
  return [
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n),
  ];
}

/**
 * Erase the backdrop in place, returning what happened. `data` is RGBA, row
 * major — an `ImageData.data` buffer or any stand-in for one.
 */
export function removeBackgroundInPlace(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tolerance = TOLERANCE,
): BackgroundRemoval {
  const pixels = width * height;
  if (pixels === 0) return { removed: false, erased: 0 };
  if (hasTransparency(data)) return { removed: false, erased: 0 };

  const [kr, kg, kb] = sampleBackgroundColor(data, width, height);
  // Compare squared distances so the inner loop needs no square root.
  const hard = tolerance * tolerance * 3 * 255 * 255;
  const soft = hard * FEATHER * FEATHER;

  const visited = new Uint8Array(pixels);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, (height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }

  let erased = 0;
  while (stack.length > 0) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    const dr = data[i]! - kr;
    const dg = data[i + 1]! - kg;
    const db = data[i + 2]! - kb;
    const dist = dr * dr + dg * dg + db * db;
    if (dist > soft) continue; // artwork — keep it opaque, and stop here
    if (dist > hard) {
      // Rim: fade from clear at the backdrop end of the band to solid at the
      // artwork end. Never expanded through, so the fill can't cross an edge.
      const t = (Math.sqrt(dist) - Math.sqrt(hard)) / (Math.sqrt(soft) - Math.sqrt(hard));
      data[i + 3] = Math.round(255 * t);
      continue;
    }
    data[i + 3] = 0;
    erased++;
    const x = p % width;
    if (x > 0 && !visited[p - 1]) stack.push(p - 1);
    if (x < width - 1 && !visited[p + 1]) stack.push(p + 1);
    if (p >= width && !visited[p - width]) stack.push(p - width);
    if (p < pixels - width && !visited[p + width]) stack.push(p + width);
  }

  const fraction = erased / pixels;
  if (fraction > MAX_ERASED) {
    for (let p = 0; p < pixels; p++) data[p * 4 + 3] = 255;
    return { removed: false, erased: 0 };
  }
  return { removed: erased > 0, erased: fraction };
}

export interface OpaqueBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Tight box around everything still visible, or null if nothing is. Trimming
 * the erased margin is what makes a stamped sticker sit at its artwork's real
 * aspect instead of inheriting the source photo's framing.
 */
export function opaqueBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  threshold = 8,
): OpaqueBounds | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! <= threshold) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

export interface StickerArtwork {
  /** PNG bytes of the cut-out, ready to upload. */
  blob: Blob;
  width: number;
  height: number;
  /** False when the source already had transparency and was left alone. */
  removed: boolean;
}

/** Transparent margin kept around the trimmed artwork, in pixels. */
const TRIM_PADDING = 1;

/**
 * Decode an image file, downscale it, erase its backdrop, and re-encode the
 * trimmed result as a PNG. PNG in, PNG out — the only format that survives the
 * round trip with an alpha channel intact.
 */
export async function cutOutSticker(file: File): Promise<StickerArtwork> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(
    1,
    CUSTOM_STICKER_MAX_PX / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is unavailable');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const image = ctx.getImageData(0, 0, width, height);
  const { removed } = removeBackgroundInPlace(image.data, width, height);
  const bounds = opaqueBounds(image.data, width, height) ?? {
    x: 0,
    y: 0,
    width,
    height,
  };
  const box = {
    x: Math.max(0, bounds.x - TRIM_PADDING),
    y: Math.max(0, bounds.y - TRIM_PADDING),
    width: Math.min(width, bounds.width + TRIM_PADDING * 2),
    height: Math.min(height, bounds.height + TRIM_PADDING * 2),
  };

  const out = document.createElement('canvas');
  out.width = box.width;
  out.height = box.height;
  const outCtx = out.getContext('2d');
  if (!outCtx) throw new Error('Canvas is unavailable');
  // Negative offsets clip the source to the trim box.
  outCtx.putImageData(image, -box.x, -box.y);

  const blob = await new Promise<Blob | null>((resolve) => {
    out.toBlob(resolve, 'image/png');
  });
  if (!blob) throw new Error('Could not encode the sticker');
  return { blob, width: box.width, height: box.height, removed };
}
