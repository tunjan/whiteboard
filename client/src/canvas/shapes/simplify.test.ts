import { describe, expect, it } from 'vitest';
import { distanceToSegment } from '@whiteboard/shared';
import { simplifyRDP } from './simplify';

/** Largest distance from any original point to the simplified polyline. */
function maxDeviation(
  original: { x: number; y: number }[],
  simplified: { x: number; y: number }[],
): number {
  let worst = 0;
  for (const p of original) {
    let best = Infinity;
    for (let i = 0; i < simplified.length - 1; i++) {
      best = Math.min(best, distanceToSegment(p, simplified[i]!, simplified[i + 1]!));
    }
    worst = Math.max(worst, best);
  }
  return worst;
}

/** A densely sampled arc, standing in for real pointer input. */
function sampledArc(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const t = (i / (count - 1)) * Math.PI;
    return { x: Math.cos(t) * 100, y: Math.sin(t) * 100, pressure: 0.5 };
  });
}

describe('simplifyRDP', () => {
  // The draw tool commits strokes at `size * 0.06`; the default brush is 4.
  const EPSILON = 4 * 0.06;

  it('keeps every original point within epsilon of the simplified curve', () => {
    const points = sampledArc(400);
    const simplified = simplifyRDP(points, EPSILON);

    // This is the fidelity guarantee the commit-time simplification relies on:
    // no part of the stroke may move further than the tolerance, which is a
    // small fraction of the brush width and so stays buried inside the ink.
    expect(maxDeviation(points, simplified)).toBeLessThanOrEqual(EPSILON);
  });

  it('meaningfully reduces a densely sampled stroke', () => {
    const points = sampledArc(400);
    const simplified = simplifyRDP(points, EPSILON);

    expect(simplified.length).toBeLessThan(points.length / 2);
    expect(simplified.length).toBeGreaterThan(2);
  });

  it('preserves the endpoints and extra per-point fields', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.1 },
      { x: 10, y: 0.01, pressure: 0.9 },
      { x: 20, y: 0, pressure: 0.4 },
    ];
    const simplified = simplifyRDP(points, EPSILON);

    expect(simplified[0]).toEqual(points[0]);
    expect(simplified[simplified.length - 1]).toEqual(points[2]);
  });

  it('leaves strokes of two or fewer points untouched', () => {
    const points = [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 5, y: 5, pressure: 0.5 },
    ];
    expect(simplifyRDP(points, EPSILON)).toEqual(points);
    expect(simplifyRDP([], EPSILON)).toEqual([]);
  });
});
