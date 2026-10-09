import { describe, expect, it } from 'vitest';
import type { Point } from '@whiteboard/shared';
import { snapStroke } from './shape-snap';

/** Seeded PRNG so a sloppy fixture is the same sloppy fixture every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32 - 0.5;
  };
}

/**
 * Trace `corners` the way a hand does: dense samples, a slow wobble along each
 * edge, jitter, and an overshoot past the start when closing.
 */
function sloppy(corners: Point[], { closed = true, wobble = 3, seed = 1 } = {}): Point[] {
  const noise = rng(seed);
  const path = closed ? [...corners, corners[0]!] : corners;
  const out: Point[] = [];
  for (let e = 0; e < path.length - 1; e++) {
    const a = path[e]!;
    const b = path[e + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    const steps = Math.ceil(len / 3);
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const off = Math.sin(t * Math.PI) * wobble + noise() * 1.5;
      out.push({ x: a.x + (b.x - a.x) * t + nx * off, y: a.y + (b.y - a.y) * t + ny * off });
    }
  }
  const end = path[path.length - 1]!;
  out.push(closed ? { x: end.x + 8, y: end.y + 5 } : { ...end });
  return out;
}

function sloppyEllipse(rx: number, ry: number, seed = 1): Point[] {
  const noise = rng(seed);
  return Array.from({ length: 120 }, (_, i) => {
    const a = (i / 115) * 2 * Math.PI; // a little past a full turn
    const r = 1 + Math.sin(a * 3) * 0.03 + noise() * 0.01;
    return { x: 200 + Math.cos(a) * rx * r, y: 200 + Math.sin(a) * ry * r };
  });
}

/** Corners of a closed snapped ring (drops the repeated closing point). */
const corners = (ring: Point[] | null) => ring?.slice(0, -1) ?? [];

describe('snapStroke', () => {
  it('snaps a sloppy scalene triangle to its own three corners', () => {
    const tri = [
      { x: 0, y: 200 },
      { x: 60, y: 0 },
      { x: 260, y: 180 },
    ];
    const result = corners(snapStroke(sloppy(tri)));
    expect(result).toHaveLength(3);
    for (const c of tri) {
      const nearest = Math.min(...result.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
      expect(nearest).toBeLessThan(15);
    }
  });

  it('closes the ring so the stroke reads as filled', () => {
    const ring = snapStroke(sloppy([{ x: 0, y: 200 }, { x: 100, y: 0 }, { x: 200, y: 200 }]))!;
    expect(ring[0]).toEqual(ring[ring.length - 1]);
  });

  it('squares up a wonky rectangle and lays it on the axes', () => {
    const quad = [
      { x: 2, y: 0 },
      { x: 300, y: 6 },
      { x: 296, y: 152 },
      { x: -4, y: 148 },
    ];
    const result = corners(snapStroke(sloppy(quad, { seed: 7 })));
    expect(result).toHaveLength(4);
    const xs = new Set(result.map((p) => Math.round(p.x)));
    const ys = new Set(result.map((p) => Math.round(p.y)));
    expect(xs.size).toBe(2);
    expect(ys.size).toBe(2);
  });

  it('keeps a rhombus a rhombus', () => {
    const result = corners(
      snapStroke(sloppy([{ x: 100, y: 0 }, { x: 200, y: 60 }, { x: 100, y: 120 }, { x: 0, y: 60 }])),
    );
    expect(result).toHaveLength(4);
    expect(new Set(result.map((p) => Math.round(p.x))).size).toBe(3);
  });

  it('snaps a wobbly circle to a true circle', () => {
    const ring = snapStroke(sloppyEllipse(100, 95))!.slice(0, -1);
    expect(ring.length).toBeGreaterThan(20);
    const cx = ring.reduce((sum, p) => sum + p.x, 0) / ring.length;
    const cy = ring.reduce((sum, p) => sum + p.y, 0) / ring.length;
    const radii = ring.map((p) => Math.hypot(p.x - cx, p.y - cy));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.5);
  });

  it('keeps a clearly oval ellipse oval', () => {
    const ring = snapStroke(sloppyEllipse(160, 80))!;
    const xs = ring.map((p) => p.x);
    const ys = ring.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1.6 * (Math.max(...ys) - Math.min(...ys)));
  });

  it('straightens a shaky line and levels a near-horizontal one', () => {
    const result = snapStroke(sloppy([{ x: 0, y: 0 }, { x: 300, y: 12 }], { closed: false, wobble: 4 }));
    expect(result).toHaveLength(2);
    expect(result![1]!.y).toBeCloseTo(result![0]!.y, 6);
  });

  it.each([
    ['an S curve', Array.from({ length: 80 }, (_, i) => ({ x: Math.sin((i / 79) * 2 * Math.PI) * 60, y: i * 4 }))],
    ['a loose spiral', Array.from({ length: 120 }, (_, i) => {
      const a = (i / 119) * 4 * Math.PI;
      return { x: Math.cos(a) * (20 + i), y: Math.sin(a) * (20 + i) };
    })],
    ['a zig-zag scribble', sloppy([{ x: 0, y: 0 }, { x: 40, y: 100 }, { x: 80, y: 0 }, { x: 120, y: 100 }, { x: 160, y: 0 }], { closed: false })],
    ['too few samples', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }]],
  ])('leaves %s alone', (_, points) => {
    expect(snapStroke(points)).toBeNull();
  });
});
