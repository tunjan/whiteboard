import { describe, expect, it } from 'vitest';
import { quantizedCullRegion, viewportWorldBounds } from './geometry';
import type { Camera } from './camera';

const W = 1180;
const H = 820;

const key = (camera: Camera) => {
  const r = quantizedCullRegion(camera, W, H);
  return `${r.minX}:${r.minY}:${r.maxX}:${r.maxY}`;
};

// Overscan margin the region must always keep past the viewport edges.
const overscanned = (camera: Camera) => {
  const vb = viewportWorldBounds(camera, W, H);
  const mx = (vb.maxX - vb.minX) * 0.25;
  const my = (vb.maxY - vb.minY) * 0.25;
  return {
    minX: vb.minX - mx,
    minY: vb.minY - my,
    maxX: vb.maxX + mx,
    maxY: vb.maxY + my,
  };
};

describe('quantizedCullRegion', () => {
  it('always contains the overscanned viewport', () => {
    for (const z of [0.1, 0.35, 0.7, 1, 1.4142, 2, 3.7, 8]) {
      for (const x of [-4000, -13, 0, 517, 90210]) {
        const camera = { x, y: x / 3, z };
        const want = overscanned(camera);
        const got = quantizedCullRegion(camera, W, H);
        expect(got.minX).toBeLessThanOrEqual(want.minX);
        expect(got.minY).toBeLessThanOrEqual(want.minY);
        expect(got.maxX).toBeGreaterThanOrEqual(want.maxX);
        expect(got.maxY).toBeGreaterThanOrEqual(want.maxY);
      }
    }
  });

  it('holds still across a sub-cell pan', () => {
    const base = { x: 500, y: 500, z: 1 };
    expect(key({ ...base, x: base.x + 4, y: base.y + 4 })).toBe(key(base));
  });

  // The regression this exists for: the cell used to be derived from the live
  // viewport width, so zoom resized the grid under itself and the snapped
  // region moved on essentially every frame of a pinch.
  it('holds still across a fine zoom sweep, unlike the live-zoom cell', () => {
    const anchor = { x: W / 2, y: H / 2 };
    // Pinch from z=1 to z=1.2 over 60 frames, anchored at the viewport centre.
    const frames: Camera[] = [];
    const world = { x: 500 + anchor.x, y: 500 + anchor.y };
    for (let i = 0; i <= 60; i++) {
      const z = 1 + (0.2 * i) / 60;
      frames.push({ x: world.x - anchor.x / z, y: world.y - anchor.y / z, z });
    }
    // The pre-fix formula, for contrast: cell sized off the live viewport.
    const liveCellKey = (camera: Camera) => {
      const vb = viewportWorldBounds(camera, W, H);
      const w = vb.maxX - vb.minX;
      const h = vb.maxY - vb.minY;
      const cx = w * 0.1;
      const cy = h * 0.1;
      return [
        Math.floor((vb.minX - w * 0.25) / cx) * cx,
        Math.floor((vb.minY - h * 0.25) / cy) * cy,
        Math.ceil((vb.maxX + w * 0.25) / cx) * cx,
        Math.ceil((vb.maxY + h * 0.25) / cy) * cy,
      ].join(':');
    };
    expect(new Set(frames.map(liveCellKey)).size).toBe(frames.length);
    expect(new Set(frames.map(key)).size).toBeLessThanOrEqual(2);
  });

  // A zoom out to fit the board and back is what the shape tree is rebuilt for,
  // so it is the sweep worth counting: one region per zoom band, not per frame.
  it('re-cuts a handful of times across a full zoom-out and back', () => {
    const anchor = { x: W / 2, y: H / 2 };
    const world = { x: 500 + anchor.x, y: 500 + anchor.y };
    const frames: Camera[] = [];
    for (let i = 0, z = 1; i < 180; i++) {
      z *= i < 48 || (i >= 96 && i < 144) ? 1 / 1.04 : 1.04;
      frames.push({ x: world.x - anchor.x / z, y: world.y - anchor.y / z, z });
    }
    expect(new Set(frames.map(key)).size).toBeLessThanOrEqual(6);
  });

  it('re-cuts the grid across a zoom band boundary', () => {
    const a = { x: 500, y: 500, z: 1 };
    const b = { x: 500, y: 500, z: 4 };
    expect(key(a)).not.toBe(key(b));
  });
});
