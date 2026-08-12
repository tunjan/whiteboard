import { describe, expect, it } from 'vitest';
import type { Bounds, Shape } from '@whiteboard/shared';
import {
  snapBounds,
  snapPoint,
  snapResizeBounds,
} from './snapping';
import { selfSnapTarget } from './snap-geometry';

const bounds = (minX: number, minY: number, maxX: number, maxY: number): Bounds => ({
  minX,
  minY,
  maxX,
  maxY,
});

describe('spatial snapping', () => {
  it('aligns box edges independently on each axis', () => {
    const result = snapBounds(
      bounds(43, 77, 83, 107),
      [bounds(40, 70, 80, 100)],
      null,
      8,
    );

    expect(result.dx).toBe(-3);
    expect(result.dy).toBe(-7);
    expect(result.guides.map((guide) => guide.axis)).toEqual(['x', 'y']);
  });

  it('centers a moving box in a gap and emits equal-spacing guides', () => {
    const result = snapBounds(
      bounds(48, 10, 68, 30),
      [bounds(0, 0, 40, 40), bounds(80, 0, 120, 40)],
      null,
      8,
    );

    expect(result.dx).toBe(2);
    expect(result.guides.filter((guide) => guide.kind === 'gap')).toHaveLength(2);
    expect(result.guides.filter((guide) => guide.kind === 'gap').map((guide) => [guide.from, guide.to]))
      .toEqual([[40, 50], [70, 80]]);
  });

  it('extends an existing sequence with its repeated gap', () => {
    const result = snapBounds(
      bounds(83, 0, 103, 20),
      [bounds(0, 0, 20, 20), bounds(40, 0, 60, 20)],
      null,
      8,
    );

    expect(result.dx).toBe(-3);
    expect(result.guides.some((guide) => guide.kind === 'gap')).toBe(true);
  });

  it('projects a corner resize back onto its locked aspect ratio', () => {
    const result = snapResizeBounds(
      bounds(0, 0, 97, 70),
      'se',
      [bounds(100, 20, 140, 60)],
      null,
      8,
      true,
      2,
    );

    expect(result.bounds).toEqual(bounds(0, 0, 100, 50));
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]?.axis).toBe('x');
  });

  it('marks every gap in an evenly spaced run, not just the driving pair', () => {
    // Three static boxes spaced 20 apart; the moving box lands on the end.
    const result = snapBounds(
      bounds(158, 0, 178, 20),
      [bounds(0, 0, 20, 20), bounds(40, 0, 60, 20), bounds(80, 0, 100, 20), bounds(120, 0, 140, 20)],
      null,
      8,
    );

    expect(result.dx).toBe(2);
    const gaps = result.guides.filter((guide) => guide.kind === 'gap');
    expect(gaps.map((guide) => [guide.from, guide.to])).toEqual([
      [20, 40],
      [60, 80],
      [100, 120],
      [140, 160],
    ]);
  });

  it('prefers the tighter of two equally close nested gaps', () => {
    // An outer pair (gap 200) and an inner pair (gap 100) both centre the box
    // at x=150; the inner run is the more specific indicator.
    const result = snapBounds(
      bounds(140, 10, 160, 30),
      [
        bounds(0, 0, 50, 40),
        bounds(250, 0, 300, 40),
        bounds(50, 5, 100, 35),
        bounds(200, 5, 250, 35),
      ],
      null,
      8,
    );

    expect(result.dx).toBe(0);
    const gaps = result.guides.filter((guide) => guide.kind === 'gap');
    expect(gaps.map((guide) => [guide.from, guide.to])).toEqual([
      [100, 140],
      [160, 200],
    ]);
  });

  it('aligns a handle to a key point axis when nothing is within reach', () => {
    const result = snapPoint(
      { x: 103, y: 260 },
      [{ points: [{ x: 100, y: 0 }], outline: [], closed: false }],
      8,
    );

    expect(result.point).toEqual({ x: 100, y: 260 });
    expect(result.guides).toHaveLength(1);
    expect(result.guides[0]).toMatchObject({
      kind: 'alignment',
      axis: 'x',
      at: 100,
      from: 0,
      to: 260,
    });
  });

  it('offers a shape its own far vertices but never the dragged one', () => {
    const line = {
      id: 'l1',
      type: 'line',
      x: 10,
      y: 20,
      rotation: 0,
      props: { points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 40 }] },
    } as unknown as Shape;

    const target = selfSnapTarget(line, 'vertex:2');

    expect(target?.points).toEqual([{ x: 10, y: 20 }, { x: 60, y: 20 }]);
    // Outline is withheld: the handle already sits on it.
    expect(target?.outline).toEqual([]);
  });

  it('projects a handle onto the closest target outline', () => {
    const result = snapPoint(
      { x: 96, y: 25 },
      [{
        points: [],
        outline: [
          { x: 100, y: 0 },
          { x: 140, y: 0 },
          { x: 140, y: 50 },
          { x: 100, y: 50 },
        ],
        closed: true,
      }],
      8,
    );

    expect(result.point).toEqual({ x: 100, y: 25 });
    expect(result.guides[0]?.kind).toBe('point');
  });
});
