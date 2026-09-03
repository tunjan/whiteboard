import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import { getSelectionInfo, matchesMarquee } from './selection-geometry';

function rectangle(
  overrides: Partial<Extract<Shape, { type: 'rectangle' }>> = {},
) {
  return {
    id: 'rectangle',
    type: 'rectangle' as const,
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      w: 100,
      h: 60,
      color: '#111',
      fillStyle: 'solid' as const,
      dash: 'solid' as const,
      size: 2,
    },
    ...overrides,
  };
}

function line(overrides: Partial<Extract<Shape, { type: 'line' }>> = {}) {
  return {
    id: 'line',
    type: 'line' as const,
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
      size: 4,
      dash: 'solid' as const,
      bend: 0,
    },
    ...overrides,
  };
}

describe('rectangle selection geometry', () => {
  it('contains rotated filled shapes only when the full visible region fits', () => {
    const shape = rectangle({ rotation: Math.PI / 4 });

    expect(
      matchesMarquee(
        shape,
        { minX: -20, minY: -30, maxX: 120, maxY: 100 },
        'wrap',
      ),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: 0, minY: 0, maxX: 100, maxY: 60 }, 'wrap'),
    ).toBe(false);
  });

  it('does not treat the hollow interior of an outlined box as a touch', () => {
    const shape = rectangle({
      props: {
        ...rectangle().props,
        fillStyle: 'none',
      },
    });

    expect(
      matchesMarquee(
        shape,
        { minX: 40, minY: 20, maxX: 60, maxY: 40 },
        'intersect',
      ),
    ).toBe(false);
    expect(
      matchesMarquee(
        shape,
        { minX: -2, minY: 20, maxX: 4, maxY: 40 },
        'intersect',
      ),
    ).toBe(true);
  });

  it('finds a stroke that crosses the marquee even when neither endpoint is inside', () => {
    const shape = line();

    expect(
      matchesMarquee(
        shape,
        { minX: 40, minY: -3, maxX: 60, maxY: 3 },
        'intersect',
      ),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: -3, minY: -3, maxX: 103, maxY: 3 }, 'wrap'),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: 40, minY: -3, maxX: 60, maxY: 3 }, 'wrap'),
    ).toBe(false);
  });

  it('requires complete enclosure for frames in both modes', () => {
    const shape: Extract<Shape, { type: 'frame' }> = {
      id: 'frame',
      type: 'frame',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: { w: 100, h: 60, name: 'Frame' },
    };

    expect(
      matchesMarquee(
        shape,
        { minX: 20, minY: 20, maxX: 80, maxY: 40 },
        'intersect',
      ),
    ).toBe(false);
    expect(
      matchesMarquee(
        shape,
        { minX: -1, minY: -1, maxX: 101, maxY: 61 },
        'intersect',
      ),
    ).toBe(true);
  });
});

describe('selection controls', () => {
  it('places four rotation targets beyond the corners at a fixed screen offset', () => {
    const shape = rectangle();
    const info = getSelectionInfo([shape], [shape.id], 2);

    expect(info?.handles.map((handle) => handle.id)).not.toContain('rotate');
    expect(info?.rotationHandles).toEqual([
      { id: 'rotate-nw', point: { x: -9, y: -9 } },
      { id: 'rotate-ne', point: { x: 109, y: -9 } },
      { id: 'rotate-se', point: { x: 109, y: 69 } },
      { id: 'rotate-sw', point: { x: -9, y: 69 } },
    ]);
  });

  it('offers the same oriented rotation controls for frame containers', () => {
    const shape: Extract<Shape, { type: 'frame' }> = {
      id: 'frame',
      type: 'frame',
      x: 10,
      y: 20,
      rotation: Math.PI / 4,
      index: 'a0',
      props: { w: 120, h: 80, name: 'Frame', color: '#475569' },
    };
    const info = getSelectionInfo([shape], [shape.id], 1);

    expect(info?.rotation).toBeCloseTo(Math.PI / 4);
    expect(info?.rotationHandles.map((handle) => handle.id)).toEqual([
      'rotate-nw',
      'rotate-ne',
      'rotate-se',
      'rotate-sw',
    ]);
  });

  it('drops handles that would overlap on a small box', () => {
    const box = (w: number, h: number) => {
      const base = rectangle();
      return { ...base, props: { ...base.props, w, h } };
    };
    const thin = box(100, 10);
    // Only 10 world px tall at zoom 1: the east and west grips would sit on
    // top of the corners, so the box keeps its corners and its top/bottom.
    expect(
      getSelectionInfo([thin], [thin.id], 1)?.handles.map((h) => h.id),
    ).toEqual(['nw', 'n', 'ne', 'se', 's', 'sw']);

    const tiny = box(8, 6);
    expect(
      getSelectionInfo([tiny], [tiny.id], 1)?.handles.map((h) => h.id),
    ).toEqual(['se']);

    // Zooming in gives the same box room for the full set.
    expect(
      getSelectionInfo([tiny], [tiny.id], 8)?.handles.map((h) => h.id),
    ).toEqual(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']);
  });

  it('preserves a shared multi-selection rotation with an oriented box', () => {
    const first = rectangle({ id: 'first', rotation: Math.PI / 2 });
    const second = rectangle({
      id: 'second',
      x: 120,
      rotation: Math.PI / 2,
    });
    const info = getSelectionInfo([first, second], [first.id, second.id], 1)!;

    expect(info.rotation).toBeCloseTo(Math.PI / 2);
    expect(info.center).toEqual({ x: 110, y: 30 });
    expect(info.corners.nw.x).toBeCloseTo(200);
    expect(info.corners.nw.y).toBeCloseTo(-20);
    expect(info.corners.se.x).toBeCloseTo(20);
    expect(info.corners.se.y).toBeCloseTo(80);
    // The box carries a full set of handles on its own axes, not the page's:
    // the east handle sits on the oriented box's east edge.
    expect(info.handles).toHaveLength(8);
    const east = info.handles.find((handle) => handle.id === 'e')!;
    expect(east.point.x).toBeCloseTo((info.corners.ne.x + info.corners.se.x) / 2);
    expect(east.point.y).toBeCloseTo((info.corners.ne.y + info.corners.se.y) / 2);
  });

  it('falls back to an axis-aligned controller for mixed rotations', () => {
    const first = rectangle({ id: 'first' });
    const second = rectangle({
      id: 'second',
      x: 120,
      rotation: Math.PI / 2,
    });
    const info = getSelectionInfo([first, second], [first.id, second.id], 1)!;

    expect(info.rotation).toBe(0);
    expect(info.center.x).toBeCloseTo(100);
    expect(info.center.y).toBeCloseTo(30);
    expect(info.corners.nw.x).toBeCloseTo(0);
    expect(info.corners.nw.y).toBeCloseTo(-20);
    expect(info.corners.se.x).toBeCloseTo(200);
    expect(info.corners.se.y).toBeCloseTo(80);
    expect(info.handles).toHaveLength(8);
    expect(info.rotationHandles).toHaveLength(4);
  });
});
