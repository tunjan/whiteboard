import { describe, expect, it } from 'vitest';
import {
  RASTER_MEMORY_LIMIT,
  rasterTiles,
  rasterZoom,
  shouldCacheShapes,
  tilePixelRatio,
} from './raster-grid';
import {
  backgroundLevel,
  backgroundRasterTransform,
} from './background-raster';

describe('raster geometry', () => {
  it('bounds zoom softness in every supported zoom band', () => {
    for (let z = 0.05; z <= 8; z *= 1.01) {
      expect(z / rasterZoom(z)).toBeGreaterThanOrEqual(2 ** -0.25);
      expect(z / rasterZoom(z)).toBeLessThanOrEqual(2 ** 0.25);
    }
  });

  it('covers the viewport across negative cells and fractional zooms', () => {
    for (const z of [0.05, 0.375, 1, 2.5, 8]) {
      const camera = { x: -777.7, y: -0.1, z };
      const zoom = rasterZoom(z);
      const tiles = rasterTiles(camera, 1200, 800, zoom);
      const visible = rasterTiles(camera, 1200, 800, zoom, 0);
      expect(visible.every((v) => tiles.some((t) => t.key === v.key))).toBe(
        true,
      );
      const step = 512 / zoom;
      expect(Math.min(...tiles.map((t) => t.x)) * step).toBeLessThanOrEqual(
        camera.x,
      );
      expect(
        (Math.max(...tiles.map((t) => t.x)) + 1) * step,
      ).toBeGreaterThanOrEqual(camera.x + 1200 / z);
    }
  });

  it('reuses cells when panning and bounds backing memory', () => {
    const a = rasterTiles({ x: 0, y: 0, z: 1 }, 1000, 800, 1);
    const b = rasterTiles({ x: 512, y: 0, z: 1 }, 1000, 800, 1);
    expect(
      b.filter((t) => a.some((old) => old.key === t.key)).length,
    ).toBeGreaterThan(b.length / 2);
    for (const count of [1, 32, 64, 256]) {
      const pixels = Math.floor(516 * tilePixelRatio(3, count));
      expect(pixels * pixels * 4 * count).toBeLessThanOrEqual(
        RASTER_MEMORY_LIMIT,
      );
    }
    expect(rasterTiles({ x: 0, y: 0, z: 1 }, 1e9, 1e9, 1)).toEqual([]);
  });

  it('gates Firefox by shape count with explicit A/B overrides', () => {
    expect(shouldCacheShapes('auto', 'Firefox/144', 199)).toBe(false);
    expect(shouldCacheShapes('auto', 'Firefox/144', 200)).toBe(true);
    expect(shouldCacheShapes('auto', 'Chrome/144', 10000)).toBe(false);
    expect(shouldCacheShapes('on', 'Chrome/144', 1)).toBe(true);
    expect(shouldCacheShapes('off', 'Firefox/144', 10000)).toBe(false);
  });
});

describe('background wallpaper', () => {
  it('wraps arbitrarily long pans to a single period', () => {
    const raster = {
      zoom: 1,
      band: 1,
      period: 32,
      periodY: 32,
      level: 'dot-4',
      ratio: 2,
    };
    const values = (x: number, y: number) =>
      backgroundRasterTransform(raster, { x, y, z: 1.1 })
        .match(/-?\d+(?:\.\d+)?(?=px)/g)!
        .map(Number);
    const a = values(3, -7),
      b = values(3 + 32 * 10000, -7 - 32 * 10000);
    expect(a[0]).toBeCloseTo(b[0]!);
    expect(a[1]).toBeCloseTo(b[1]!);
  });

  it('tracks line spacing and dot fade membership independently', () => {
    expect(backgroundLevel('dot', { x: 0, y: 0, z: 1 })).toBe('dot-4,dot-1');
    expect(backgroundLevel('graph', { x: 0, y: 0, z: 1 })).toBe('20');
    expect(backgroundLevel('coordinate', { x: 0, y: 0, z: 1 })).toBe('20');
  });
});
