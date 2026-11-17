import { describe, expect, it } from 'vitest';
import { CLOUD_BUMP_SAMPLES, polygonVerticesForBox } from './polygon-geometry';

const bumps = (w: number, h: number, size = 2) =>
  polygonVerticesForBox('cloud', 0, 0, w, h, 'shape:a', size).length /
  CLOUD_BUMP_SAMPLES;

describe('cloud', () => {
  it('adds bumps as it grows instead of stretching them', () => {
    expect(bumps(100, 100)).toBe(7);
    expect(bumps(400, 100)).toBeGreaterThan(2 * bumps(100, 100));
  });

  it('uses fewer, wider bumps at a heavier stroke', () => {
    expect(bumps(600, 300, 10)).toBeLessThan(bumps(600, 300, 2));
  });

  it('stays inside its box', () => {
    for (const [w, h] of [[100, 100], [500, 80], [40, 300], [5, 5]] as const) {
      for (const p of polygonVerticesForBox('cloud', 10, 20, w, h, 'shape:b', 3.5)) {
        expect(p.x).toBeGreaterThanOrEqual(10 - 1e-6);
        expect(p.x).toBeLessThanOrEqual(10 + w + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(20 - 1e-6);
        expect(p.y).toBeLessThanOrEqual(20 + h + 1e-6);
      }
    }
  });

  it('is the same cloud for the same shape and a different one for another', () => {
    const a = polygonVerticesForBox('cloud', 0, 0, 300, 200, 'shape:a');
    expect(polygonVerticesForBox('cloud', 0, 0, 300, 200, 'shape:a')).toEqual(a);
    expect(polygonVerticesForBox('cloud', 0, 0, 300, 200, 'shape:z')).not.toEqual(a);
  });
});
