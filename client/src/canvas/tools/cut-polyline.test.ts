import { describe, expect, it } from 'vitest';
import type { Point } from '@whiteboard/shared';
import { cutPolyline } from './cut-polyline';

interface Sample extends Point {
  pressure?: number;
}

const lerp = (from: Sample, to: Sample, t: number): Sample => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
  pressure:
    from.pressure !== undefined && to.pressure !== undefined
      ? from.pressure + (to.pressure - from.pressure) * t
      : from.pressure,
});

/** A horizontal line from (0,0) to (100,0), sampled every `step` units. */
function horizontal(step: number): Sample[] {
  const out: Sample[] = [];
  for (let x = 0; x <= 100; x += step) out.push({ x, y: 0 });
  return out;
}

describe('cutPolyline', () => {
  it('splits into two runs when the swipe crosses the middle', () => {
    const runs = cutPolyline(horizontal(1), { x: 50, y: -10 }, { x: 50, y: 10 }, 2, lerp);

    expect(runs).toHaveLength(2);
    expect(runs[0]![0]).toEqual({ x: 0, y: 0 });
    expect(runs[0]![runs[0]!.length - 1]!.x).toBeCloseTo(48);
    expect(runs[1]![0]!.x).toBeCloseTo(52);
    expect(runs[1]![runs[1]!.length - 1]).toEqual({ x: 100, y: 0 });
  });

  it('leaves one run when the swipe takes an end off', () => {
    const runs = cutPolyline(horizontal(1), { x: 95, y: -10 }, { x: 95, y: 10 }, 8, lerp);

    expect(runs).toHaveLength(1);
    expect(runs[0]![0]).toEqual({ x: 0, y: 0 });
    expect(runs[0]![runs[0]!.length - 1]!.x).toBeCloseTo(87);
  });

  it('returns nothing when the swipe covers the whole polyline', () => {
    const runs = cutPolyline(horizontal(1), { x: -10, y: 0 }, { x: 110, y: 0 }, 5, lerp);

    expect(runs).toEqual([]);
  });

  it('leaves the polyline untouched when the swipe misses it', () => {
    const points = horizontal(1);
    const runs = cutPolyline(points, { x: 50, y: 40 }, { x: 60, y: 40 }, 5, lerp);

    expect(runs).toHaveLength(1);
    expect(runs[0]).toEqual(points);
  });

  // The reason the cut is solved per segment rather than per stored point: here
  // the eraser is far narrower than the gap between samples, so no sample is
  // inside it, yet the swipe plainly passes through the line.
  it('cuts between two widely spaced samples', () => {
    const runs = cutPolyline(
      [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      { x: 50, y: -10 },
      { x: 50, y: 10 },
      1,
      lerp,
    );

    expect(runs).toHaveLength(2);
    expect(runs[0]![1]!.x).toBeCloseTo(49);
    expect(runs[1]![0]!.x).toBeCloseTo(51);
  });

  it('cuts with a bare disc when the swipe has no length', () => {
    const runs = cutPolyline(horizontal(1), { x: 50, y: 0 }, { x: 50, y: 0 }, 4, lerp);

    expect(runs).toHaveLength(2);
    expect(runs[0]![runs[0]!.length - 1]!.x).toBeCloseTo(46);
    expect(runs[1]![0]!.x).toBeCloseTo(54);
  });

  it('interpolates the extra fields of a cut boundary point', () => {
    const runs = cutPolyline(
      [
        { x: 0, y: 0, pressure: 0 },
        { x: 100, y: 0, pressure: 1 },
      ],
      { x: 80, y: -10 },
      { x: 80, y: 10 },
      1,
      lerp,
    );

    expect(runs).toHaveLength(2);
    expect(runs[0]![1]!.pressure).toBeCloseTo(0.79);
  });

  it('keeps or removes a single-point stroke whole', () => {
    const dot: Sample[] = [{ x: 10, y: 10 }];

    expect(cutPolyline(dot, { x: 10, y: 10 }, { x: 10, y: 10 }, 4, lerp)).toEqual([]);
    expect(cutPolyline(dot, { x: 50, y: 50 }, { x: 60, y: 50 }, 4, lerp)).toEqual([dot]);
  });

  it('drops fragments too short to be ink', () => {
    // Two cuts 1.5 units apart leave a sliver between them, but the sliver has
    // two boundary points, so it survives; a run reduced to a single sample
    // does not.
    const runs = cutPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      { x: -5, y: 0 },
      { x: 9.999, y: 0 },
      1,
      lerp,
    );

    expect(runs).toEqual([]);
  });
});
