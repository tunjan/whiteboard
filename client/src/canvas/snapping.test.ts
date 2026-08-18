import { describe, expect, it } from 'vitest';
import type { Bounds, Shape } from '@whiteboard/shared';
import {
  shortAngleDist,
  snapAngle,
  snapBounds,
  snapPoint,
  snapResizeBounds,
} from './snapping';
import { selfSnapTarget } from './snap-geometry';

const bounds = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Bounds => ({
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
    // Landing on the target box makes all three coordinates coincide per axis.
    expect(
      result.guides.filter((guide) => guide.axis === 'x').map((g) => g.at),
    ).toEqual([40, 60, 80]);
    expect(
      result.guides.filter((guide) => guide.axis === 'y').map((g) => g.at),
    ).toEqual([70, 85, 100]);
  });

  it('gives object snaps precedence over a closer grid line on both axes', () => {
    const result = snapBounds(
      bounds(7, 7, 9, 9),
      [bounds(12, 100, 12, 100)],
      10,
      8,
    );

    expect(result.dx).toBe(3);
    // Once the X object guide is active, the otherwise closer Y grid line is
    // suspended for this sample.
    expect(result.dy).toBe(0);
    expect(result.guides.map((guide) => guide.at)).toEqual([12]);
  });

  it('ignores the locked axis when resolving object versus grid snaps', () => {
    const result = snapBounds(
      bounds(7, 7, 9, 9),
      [bounds(100, 12, 100, 12)],
      10,
      8,
      { axis: 'x' },
    );

    expect(result.dx).toBe(1);
    expect(result.dy).toBe(0);
    expect(result.guides).toEqual([]);
  });

  it('normalizes distance noise before threshold comparison', () => {
    const result = snapBounds(
      bounds(108.0000000001, 20, 118.0000000001, 30),
      [bounds(100, 100, 100, 100)],
      null,
      8,
    );

    expect(result.dx).toBeCloseTo(-8.0000000001, 10);
  });

  it('aligns transformed feature points that are inside an axis-aligned box', () => {
    const result = snapBounds(
      bounds(0, 0, 100, 100),
      [
        {
          ...bounds(0, 200, 100, 300),
          points: [{ x: 30, y: 250 }],
        },
      ],
      null,
      8,
      { points: [{ x: 24, y: 50 }] },
    );

    expect(result.dx).toBe(6);
    expect(result.guides.map((guide) => guide.at)).toEqual([30]);
  });

  it('reports every alignment the nudge produces, not just the closest one', () => {
    // A -3 nudge lines the box up with all three of A's coordinates and with
    // B's left edge; every one of them belongs to this placement.
    const result = snapBounds(
      bounds(43, 300, 73, 330),
      [bounds(40, 0, 70, 40), bounds(70, 100, 90, 140)],
      null,
      8,
    );

    expect(result.dx).toBe(-3);
    expect(result.guides.map((guide) => guide.at)).toEqual([40, 55, 70]);
    // The shared coordinate merges into one guide spanning both targets.
    expect(result.guides.find((guide) => guide.at === 70)).toMatchObject({
      from: 0,
      to: 330,
    });
  });

  it('keeps a resize guide on the dragged edge only', () => {
    // The stationary left edge sits on the target's left edge, but the drag is
    // on the east edge: only that alignment is part of the snap.
    const result = snapResizeBounds(
      bounds(0, 0, 37, 40),
      'e',
      [bounds(0, 60, 40, 100)],
      null,
      8,
      false,
      1,
    );

    expect(result.bounds).toEqual(bounds(0, 0, 40, 40));
    expect(result.guides.map((guide) => guide.at)).toEqual([40]);
  });

  it('centers a moving box in a gap and emits equal-spacing guides', () => {
    const result = snapBounds(
      bounds(48, 10, 68, 30),
      [bounds(0, 0, 40, 40), bounds(80, 0, 120, 40)],
      null,
      8,
    );

    expect(result.dx).toBe(2);
    expect(result.guides.filter((guide) => guide.kind === 'gap')).toHaveLength(
      2,
    );
    expect(
      result.guides
        .filter((guide) => guide.kind === 'gap')
        .map((guide) => [guide.from, guide.to]),
    ).toEqual([
      [40, 50],
      [70, 80],
    ]);
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

  it('does not form a distribution gap from boxes that only touch crosswise', () => {
    const result = snapBounds(
      bounds(83, 0, 103, 10),
      [bounds(0, 10, 20, 20), bounds(40, 10, 60, 20)],
      null,
      8,
    );

    expect(result.dx).toBe(0);
    expect(result.guides.some((guide) => guide.kind === 'gap')).toBe(false);
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

  it('uses a non-zero aspect snap instead of an already aligned axis', () => {
    const result = snapResizeBounds(
      bounds(0, 0, 100, 47),
      'se',
      [bounds(100, 50, 140, 90)],
      null,
      8,
      true,
      2,
    );

    expect(result.bounds).toEqual(bounds(0, 0, 100, 50));
    expect(result.guides.map((guide) => guide.axis)).toEqual(['y']);
  });

  it('marks every gap in an evenly spaced run, not just the driving pair', () => {
    // Three static boxes spaced 20 apart; the moving box lands on the end.
    const result = snapBounds(
      bounds(158, 0, 178, 20),
      [
        bounds(0, 0, 20, 20),
        bounds(40, 0, 60, 20),
        bounds(80, 0, 100, 20),
        bounds(120, 0, 140, 20),
      ],
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
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 50, y: 40 },
        ],
      },
    } as unknown as Shape;

    const target = selfSnapTarget(line, 'vertex:2');

    expect(target?.points).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 20 },
    ]);
    // Outline is withheld: the handle already sits on it.
    expect(target?.outline).toEqual([]);
  });

  it('projects a handle onto the closest target outline', () => {
    const result = snapPoint(
      { x: 96, y: 25 },
      [
        {
          points: [],
          outline: [
            { x: 100, y: 0 },
            { x: 140, y: 0 },
            { x: 140, y: 50 },
            { x: 100, y: 50 },
          ],
          closed: true,
        },
      ],
      8,
    );

    expect(result.point).toEqual({ x: 100, y: 25 });
    expect(result.guides[0]?.kind).toBe('point');
  });

  it('prioritizes a nearby key point over a closer outline projection', () => {
    const result = snapPoint(
      { x: 96, y: 0 },
      [
        {
          points: [{ x: 100, y: 0 }],
          outline: [
            { x: 97, y: -10 },
            { x: 97, y: 10 },
          ],
          closed: false,
        },
      ],
      8,
    );

    expect(result.point).toEqual({ x: 100, y: 0 });
  });

  it('harvests every collinear point for a handle alignment guide', () => {
    const result = snapPoint(
      { x: 103, y: 50 },
      [
        {
          points: [
            { x: 100, y: 0 },
            { x: 100, y: 200 },
          ],
          outline: [],
          closed: false,
        },
      ],
      8,
    );

    expect(result.guides[0]).toMatchObject({ from: 0, to: 200 });
  });

  it('quantizes rotation across the signed angle boundary', () => {
    expect(snapAngle((179 * Math.PI) / 180, 24)).toBeCloseTo(Math.PI);
    expect(snapAngle((359 * Math.PI) / 180, 24)).toBeCloseTo(0);
    expect(
      shortAngleDist((179 * Math.PI) / 180, (-179 * Math.PI) / 180),
    ).toBeCloseTo((2 * Math.PI) / 180);
  });
});
