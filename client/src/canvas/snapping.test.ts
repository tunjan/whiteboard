import { describe, expect, it } from 'vitest';
import type { Bounds } from '@whiteboard/shared';
import {
  snapBounds,
  snapPoint,
  snapResizeBounds,
} from './snapping';

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
