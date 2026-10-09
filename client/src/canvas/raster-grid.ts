import type { Camera } from './camera';
import { CULL_OVERSCAN } from './geometry';

export const RASTER_TILE_SIZE = 512;
export const RASTER_TILE_BLEED = 2;
export const RASTER_MEMORY_LIMIT = 64 * 1024 * 1024;

/** Nearest √2 level: at most 19% magnification before the next level. */
export function rasterZoom(z: number): number {
  return Number.isFinite(z) && z > 0
    ? 2 ** (Math.round(Math.log2(z) * 2) / 2)
    : 1;
}

export interface RasterTile {
  key: string;
  x: number;
  y: number;
}

/** World-aligned cells, ordered viewport first, then the leading-edge margin. */
export function rasterTiles(
  camera: Camera,
  width: number,
  height: number,
  zoom: number,
  overscan = CULL_OVERSCAN,
): RasterTile[] {
  if (width <= 0 || height <= 0 || camera.z <= 0) return [];
  const step = RASTER_TILE_SIZE / zoom;
  const w = width / camera.z,
    h = height / camera.z;
  const x0 = Math.floor((camera.x - w * overscan) / step);
  const y0 = Math.floor((camera.y - h * overscan) / step);
  const x1 = Math.ceil((camera.x + w * (1 + overscan)) / step);
  const y1 = Math.ceil((camera.y + h * (1 + overscan)) / step);
  // Reject unreasonable viewports before allocating or looping.
  if ((x1 - x0) * (y1 - y0) > 256) return [];
  const tiles: RasterTile[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) tiles.push({ key: `${x}:${y}`, x, y });
  }
  const cx = (camera.x + w / 2) / step,
    cy = (camera.y + h / 2) / step;
  const visible = (t: RasterTile) =>
    t.x * step < camera.x + w &&
    (t.x + 1) * step > camera.x &&
    t.y * step < camera.y + h &&
    (t.y + 1) * step > camera.y;
  return tiles.sort(
    (a, b) =>
      Number(visible(b)) - Number(visible(a)) ||
      Math.hypot(a.x + 0.5 - cx, a.y + 0.5 - cy) -
        Math.hypot(b.x + 0.5 - cx, b.y + 0.5 - cy),
  );
}

export function tilePixelRatio(deviceRatio: number, tileCount: number): number {
  const side = RASTER_TILE_SIZE + RASTER_TILE_BLEED * 2;
  return Math.min(
    Math.max(deviceRatio || 1, 1),
    2,
    Math.sqrt(RASTER_MEMORY_LIMIT / (Math.max(1, tileCount) * side * side * 4)),
  );
}

export type RasterCacheMode = 'auto' | 'on' | 'off';

/** Chromium regressed in the earlier snapshot experiment. Start with Firefox
 * on substantial scenes; explicit overrides allow identical cross-engine A/Bs. */
export function shouldCacheShapes(
  mode: RasterCacheMode,
  userAgent: string,
  count: number,
): boolean {
  if (mode === 'off' || count === 0) return false;
  if (mode === 'on') return true;
  return /Firefox\//.test(userAgent) && count >= 200;
}
