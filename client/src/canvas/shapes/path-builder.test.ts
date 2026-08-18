import { describe, expect, it } from 'vitest';
import { PathBuilder } from './path-builder';

describe('PathBuilder', () => {
  it('serializes a command graph with centi-pixel coordinates', () => {
    const path = new PathBuilder()
      .move({ x: 0, y: 0 })
      .line({ x: 10, y: 0 })
      .quadratic({ x: 15, y: 5 }, { x: 20, y: 0 })
      .cubic({ x: 25, y: -5 }, { x: 30, y: 5 }, { x: 35, y: 0 })
      .close();

    expect(path.toD()).toBe('M 0 0 l 10 0 q 5 5 10 0 c 5 -5 10 5 15 0 Z');
    expect(path.getCommands()).toHaveLength(5);
  });

  it('flattens quadratic, cubic, arc, and close commands', () => {
    const path = new PathBuilder()
      .move({ x: 0, y: 0 })
      .quadratic({ x: 5, y: 10 }, { x: 10, y: 0 })
      .cubic({ x: 12, y: -2 }, { x: 18, y: -2 }, { x: 20, y: 0 })
      .arc(5, 5, 0, false, true, { x: 30, y: 0 })
      .close();
    const points = path.toPolylines(8)[0]!;

    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points.at(-1)).toEqual({ x: 0, y: 0 });
    expect(points.some((point) => point.y > 0)).toBe(true);
    expect(path.length()).toBeGreaterThan(50);
  });

  it('measures a straight cubic and a quarter circle exactly', () => {
    // A cubic whose controls lie on the segment is a straight run of length 30.
    const straight = new PathBuilder()
      .move({ x: 0, y: 0 })
      .cubic({ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 });
    expect(straight.length()).toBeCloseTo(30, 9);

    // A quarter of a unit-radius circle, scaled by 10.
    const quarter = new PathBuilder()
      .move({ x: 10, y: 0 })
      .arc(10, 10, 0, false, true, { x: 0, y: 10 });
    expect(quarter.length()).toBeCloseTo((Math.PI / 2) * 10, 9);
  });

  it('does not under-report a curve the way a flattened copy does', () => {
    const path = new PathBuilder()
      .move({ x: 0, y: 0 })
      .quadratic({ x: 0, y: 20 }, { x: 20, y: 20 });
    const chords = path
      .toPolylines(8)[0]!
      .reduce(
        (total, point, index, points) =>
          index === 0
            ? 0
            : total +
              Math.hypot(
                point.x - points[index - 1]!.x,
                point.y - points[index - 1]!.y,
              ),
        0,
      );

    expect(path.length()).toBeGreaterThan(chords);
    expect((path.length() - chords) / path.length()).toBeLessThan(0.005);
  });

  it('keeps separate move commands as separate polylines', () => {
    const paths = new PathBuilder()
      .move({ x: 0, y: 0 })
      .line({ x: 1, y: 0 })
      .move({ x: 10, y: 10 })
      .line({ x: 11, y: 10 })
      .toPolylines();

    expect(paths).toEqual([
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      [
        { x: 10, y: 10 },
        { x: 11, y: 10 },
      ],
    ]);
  });
});
