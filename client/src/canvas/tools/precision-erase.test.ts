import { describe, expect, it } from 'vitest';
import {
  type Point,
  type Shape,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import { cutRuns, cuttablePoints, fragmentShape } from './precision-erase';

function stroke(rotation: number): Extract<Shape, { type: 'draw' }> {
  return {
    id: 'ink',
    type: 'draw',
    x: 100,
    y: 50,
    rotation,
    index: 'a0',
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
        { x: 40, y: 0 },
      ],
      isClosed: false,
      color: '#111',
      size: 4,
      dash: 'solid',
      fillStyle: 'none',
    },
  };
}

/**
 * Where a shape's renderer puts one of its local points. Mirrors the transform
 * in draw.tsx: translate by the origin, then rotate about the centre of the
 * shape's own points' bounds.
 */
function worldOf(shape: Shape, points: readonly Point[], local: Point): Point {
  const b = pointsBounds(points);
  const centre = {
    x: shape.x + (b.minX + b.maxX) / 2,
    y: shape.y + (b.minY + b.maxY) / 2,
  };
  return rotatePoint(
    { x: shape.x + local.x, y: shape.y + local.y },
    centre,
    shape.rotation,
  );
}

describe('cuttablePoints', () => {
  it('flattens a bent line to the curve its renderer draws', () => {
    const line: Extract<Shape, { type: 'line' }> = {
      id: 'l',
      type: 'line',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: '#111',
        size: 2,
        dash: 'solid',
        bend: 30,
      },
    };

    const points = cuttablePoints(line)!;
    expect(points.length).toBeGreaterThan(2);
    // The apex sits off the chord by the bend amount.
    const apex = points.reduce((a, b) => (Math.abs(b.y) > Math.abs(a.y) ? b : a));
    expect(Math.abs(apex.y)).toBeCloseTo(30, 0);
  });

  it('returns null for a shape with no meaningful half', () => {
    const rect = {
      id: 'r',
      type: 'rectangle',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: { w: 10, h: 10, color: '#111', fillStyle: 'none', dash: 'solid', size: 2 },
    } as Shape;

    expect(cuttablePoints(rect)).toBeNull();
  });
});

describe('fragmentShape', () => {
  it('leaves the origin alone for an unrotated shape', () => {
    const shape = stroke(0);
    const fragment = fragmentShape(shape, shape.props.points.slice(0, 2), 'a');

    expect(fragment.x).toBe(shape.x);
    expect(fragment.y).toBe(shape.y);
  });

  // Ink rotates about the centre of its own points' bounds, which a fragment no
  // longer shares with its parent — so without the origin correction each piece
  // would swing away from where its ink was drawn.
  it('keeps every fragment of a rotated stroke exactly where its ink was', () => {
    const shape = stroke(Math.PI / 4);
    const runs = [shape.props.points.slice(0, 2), shape.props.points.slice(3)];

    for (const run of runs) {
      const fragment = fragmentShape(shape, run, 'f') as Extract<Shape, { type: 'draw' }>;
      for (const local of run) {
        const before = worldOf(shape, shape.props.points, local);
        const after = worldOf(fragment, fragment.props.points, local);
        expect(after.x).toBeCloseTo(before.x, 9);
        expect(after.y).toBeCloseTo(before.y, 9);
      }
    }
  });

  it('opens a cut loop so it is no longer filled as an area', () => {
    const shape = stroke(0);
    shape.props.isClosed = true;
    const fragment = fragmentShape(shape, shape.props.points.slice(0, 3), 'a');

    expect((fragment as Extract<Shape, { type: 'draw' }>).props.isClosed).toBe(false);
  });
});

describe('cutRuns', () => {
  it('returns the same runs when the swipe misses', () => {
    const shape = stroke(0);
    const runs = [shape.props.points];
    expect(cutRuns(shape, runs, { x: 0, y: 0 }, { x: 10, y: 0 }, 4)).toBe(runs);
  });

  it('cuts a rotated stroke where the swipe crosses its visible ink', () => {
    const shape = stroke(Math.PI / 4);
    // Aim at the world position of the stroke's midpoint, not its local one.
    const hit = worldOf(shape, shape.props.points, { x: 20, y: 0 });
    const runs = cutRuns(
      shape,
      [shape.props.points],
      { x: hit.x, y: hit.y - 20 },
      { x: hit.x, y: hit.y + 20 },
      2,
    );

    expect(runs).toHaveLength(2);
    expect(runs[0]![runs[0]!.length - 1]!.x).toBeLessThan(20);
    expect(runs[1]![0]!.x).toBeGreaterThan(20);
  });
});
