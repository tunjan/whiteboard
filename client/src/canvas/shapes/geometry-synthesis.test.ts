import { describe, expect, it } from 'vitest';
import {
  ellipseSynthesisPoints,
  synthesizeDrawPaths,
} from './geometry-synthesis';

const square = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('hand-drawn geometry synthesis', () => {
  it('is byte-deterministic for a shape id and produces two distinct passes', () => {
    const first = synthesizeDrawPaths(square, {
      seed: 'shape-7',
      size: 6,
      closed: true,
    });
    const second = synthesizeDrawPaths(square, {
      seed: 'shape-7',
      size: 6,
      closed: true,
    });

    expect(first).toEqual(second);
    expect(first).toHaveLength(2);
    expect(first[0]).not.toBe(first[1]);
    expect(first.every((path) => path.endsWith(' Z'))).toBe(true);
  });

  it('changes its stable wobble when the shape id changes', () => {
    expect(
      synthesizeDrawPaths(square, {
        seed: 'shape-a',
        size: 6,
        closed: true,
      }),
    ).not.toEqual(
      synthesizeDrawPaths(square, {
        seed: 'shape-b',
        size: 6,
        closed: true,
      }),
    );
  });

  it('rounds interior corners with quadratic commands', () => {
    const [path] = synthesizeDrawPaths(square, {
      seed: 'corners',
      size: 4,
      closed: true,
      passes: 1,
    });

    expect(path).toContain(' q ');
    expect(path?.match(/ q /g)).toHaveLength(4);
  });

  it('generates a stable closed ellipse perimeter without duplicating its seam', () => {
    const points = ellipseSynthesisPoints(20, 30, 10, 5, 24);
    const paths = synthesizeDrawPaths(points, {
      seed: 'ellipse',
      size: 3.5,
      closed: true,
    });

    expect(points).toHaveLength(24);
    expect(points[0]).not.toEqual(points.at(-1));
    expect(paths).toHaveLength(2);
    expect(paths.every((path) => path.endsWith(' Z'))).toBe(true);
  });

  it('returns no geometry for an invalid brush or fewer than two points', () => {
    expect(synthesizeDrawPaths([], { seed: 'x', size: 4 })).toEqual([]);
    expect(
      synthesizeDrawPaths([{ x: 0, y: 0 }], { seed: 'x', size: 4 }),
    ).toEqual([]);
    expect(synthesizeDrawPaths(square, { seed: 'x', size: 0 })).toEqual([]);
  });
});
