import { describe, expect, it } from 'vitest';
import { rotatePoint, type Shape } from '@whiteboard/shared';
import './shapes/register';
import {
  getSelectionInfo,
  hitSelectionHandle,
  matchesMarquee,
  rotateResizeHandle,
} from './selection-geometry';
import { resizeCursor } from './resize-cursor';

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

  it('rotates a connector about the pivot its renderer uses', () => {
    // A straight arrow draws only its endpoints, so it pivots about their
    // midpoint (50, 0), not the centre of every stored waypoint (50, 50).
    const shape: Extract<Shape, { type: 'arrow' }> = {
      id: 'arrow',
      type: 'arrow',
      x: 0,
      y: 0,
      rotation: Math.PI / 2,
      index: 'a0',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 100 },
          { x: 100, y: 0 },
        ],
        color: '#111',
        size: 2,
        dash: 'solid',
        arrowStart: false,
        arrowEnd: false,
        bend: 0,
        topology: 'straight',
        bindings: {},
        label: '',
      },
    };

    // Rendered: a vertical stroke at x = 50 from y = -50 to 50.
    expect(
      matchesMarquee(
        shape,
        { minX: 40, minY: -40, maxX: 60, maxY: -10 },
        'intersect',
      ),
    ).toBe(true);
    expect(
      matchesMarquee(
        shape,
        { minX: 90, minY: 10, maxX: 110, maxY: 90 },
        'intersect',
      ),
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
  it('rotates from a knob below the box, never from a corner', () => {
    const shape = rectangle();
    const info = getSelectionInfo([shape], [shape.id], 2)!;

    // The lane above belongs to the contextual toolbar. The knob sits a
    // screen-constant 24px out, so at zoom 2 that is 12 world units.
    expect(info.rotateHandle?.point.x).toBeCloseTo(50);
    expect(info.rotateHandle?.point.y).toBeCloseTo(60 + 12);
    // A cursor's grab zone is the other handles' one.
    expect(info.rotateHandle?.radius).toBeCloseTo(10 / 2);
    // Every corner is still a resize handle.
    expect(info.handles.map((handle) => handle.id)).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
  });

  it('keeps the knob clear of the bottom edge\'s resize target', () => {
    const shape = rectangle();
    const info = getSelectionInfo([shape], [shape.id], 1)!;
    const knob = info.rotateHandle!;
    const south = info.handles.find((handle) => handle.id === 's')!;

    // Nowhere in the knob's grab zone reaches the edge's target.
    expect(knob.point.y - knob.radius).toBeGreaterThan(
      south.point.y + info.hitTarget.y,
    );
  });

  it('turns the knob with a rotated frame container', () => {
    const shape: Extract<Shape, { type: 'frame' }> = {
      id: 'frame',
      type: 'frame',
      x: 10,
      y: 20,
      rotation: Math.PI / 4,
      index: 'a0',
      props: { w: 120, h: 80, name: 'Frame', color: '#475569' },
    };
    const info = getSelectionInfo([shape], [shape.id], 1)!;

    expect(info.rotation).toBeCloseTo(Math.PI / 4);
    // In the box's own frame the knob is centred beneath it.
    const local = rotatePoint(info.rotateHandle!.point, info.center, -Math.PI / 4);
    expect(local.x).toBeCloseTo(info.center.x);
    expect(local.y).toBeCloseTo(info.center.y + 40 + 24);
  });

  it('culls handles in stages as the box gets smaller', () => {
    const box = (w: number, h: number) => {
      const base = rectangle();
      return { ...base, props: { ...base.props, w, h } };
    };
    const handlesOf = (shape: Shape, zoom = 1) =>
      getSelectionInfo([shape], [shape.id], zoom)?.handles.map((h) => h.id);

    // Room for everything.
    expect(handlesOf(box(100, 60))).toEqual([
      'nw',
      'n',
      'ne',
      'e',
      'se',
      's',
      'sw',
      'w',
    ]);
    // Small but not tiny: the full set survives, paid for out of the hit
    // targets rather than the handles (see the contraction test below).
    expect(handlesOf(box(20, 20))).toHaveLength(8);
    // Tiny on one axis: one diagonal of corners, and no edges between them.
    expect(handlesOf(box(100, 10))).toEqual(['nw', 'se']);
    // Tiny on both: a single grip, so the interior stays grabbable.
    expect(handlesOf(box(8, 6))).toEqual(['nw']);
    // The thresholds are screen-sized, so zooming in restores the full set.
    expect(handlesOf(box(8, 6), 8)).toHaveLength(8);
  });

  it('halves hit targets on a small axis so the middle stays free', () => {
    const box = (w: number, h: number) => {
      const base = rectangle();
      return { ...base, props: { ...base.props, w, h } };
    };
    const roomy = getSelectionInfo([box(100, 60)], ['rectangle'], 1)!;
    expect(roomy.hitTarget).toEqual({ x: 4.5, y: 4.5 });

    // 20 world px tall at zoom 1 is under the 32px small threshold: the north
    // and south targets halve so they cannot meet across the box.
    const short = getSelectionInfo([box(100, 20)], ['rectangle'], 1)!;
    expect(short.hitTarget).toEqual({ x: 4.5, y: 2.25 });
    expect(short.hitTarget.y * 2).toBeLessThan(20);

    // Zoom scales them with the screen, not the document.
    const zoomed = getSelectionInfo([box(100, 60)], ['rectangle'], 2)!;
    expect(zoomed.hitTarget).toEqual({ x: 2.25, y: 2.25 });
  });

  it('drops the knob only once both axes are small', () => {
    const base = rectangle();
    const thin = { ...base, props: { ...base.props, w: 100, h: 10 } };
    expect(getSelectionInfo([thin], [thin.id], 1)?.rotateHandle).not.toBe(null);

    const small = { ...base, props: { ...base.props, w: 20, h: 20 } };
    expect(getSelectionInfo([small], [small.id], 1)?.rotateHandle).toBe(null);
  });

  it('grabs a corner over the edge band it overlaps', () => {
    const shape = rectangle();
    const info = getSelectionInfo([shape], [shape.id], 1)!;

    // A corner is a square centred on it.
    expect(hitSelectionHandle(info, { x: 3, y: 3 })).toBe('nw');
    expect(hitSelectionHandle(info, { x: 10, y: 10 })).toBe(null);
    // An edge handle is the band along the whole edge, not just its midpoint.
    expect(hitSelectionHandle(info, { x: 100, y: 50 })).toBe('e');
    expect(hitSelectionHandle(info, { x: 90, y: 30 })).toBe(null);
    // Where the two overlap, the corner wins.
    expect(hitSelectionHandle(info, { x: 100, y: 2 })).toBe('ne');
  });

  it('keeps handle targets square to a rotated box', () => {
    const shape = rectangle({ rotation: Math.PI / 2 });
    const info = getSelectionInfo([shape], [shape.id], 1)!;
    const east = info.handles.find((h) => h.id === 'e')!;

    // A quarter turn lays that edge along the page's x axis: 20 world units
    // along the edge is still inside the band.
    expect(
      hitSelectionHandle(info, { x: east.point.x + 20, y: east.point.y }),
    ).toBe('e');
    // The same distance across it is outside.
    expect(
      hitSelectionHandle(info, { x: east.point.x, y: east.point.y + 20 }),
    ).toBe(null);
  });

  it('keeps the touch knob above the box and drops edge handles', () => {
    const base = rectangle();
    const shape = { ...base, props: { ...base.props, w: 100, h: 60 } };
    const info = getSelectionInfo([shape], [shape.id], 1, undefined, true)!;

    // Edge handles go: a fingertip covers an edge it did not aim for.
    expect(info.handles.map((h) => h.id)).toEqual(['nw', 'ne', 'se', 'sw']);
    // The knob sits above the box by default.
    expect(info.rotateHandle?.point.x).toBeCloseTo(50);
    expect(info.rotateHandle!.point.y).toBeLessThan(0);

    // A narrow box puts it out to the left instead.
    const narrow = { ...base, props: { ...base.props, w: 20, h: 60 } };
    const narrowInfo = getSelectionInfo(
      [narrow],
      [narrow.id],
      1,
      undefined,
      true,
    )!;
    expect(narrowInfo.rotateHandle!.point.x).toBeLessThan(0);
    expect(narrowInfo.rotateHandle?.point.y).toBeCloseTo(30);

    // Small on both axes there is nowhere to put it that is not in the way.
    const small = { ...base, props: { ...base.props, w: 20, h: 20 } };
    expect(
      getSelectionInfo([small], [small.id], 1, undefined, true)
        ?.rotateHandle,
    ).toBe(null);
  });

  it('keeps a text shape\'s width handles on a coarse pointer', () => {
    const text: Extract<Shape, { type: 'text' }> = {
      id: 'text',
      type: 'text',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        text: 'one\ntwo',
        color: '#111111',
        fontSize: 24,
        fontFamily: 'sans',
        fontWeight: 400,
        sizingMode: 'fixed',
        width: 200,
        lineHeight: 1.2,
        align: 'start',
      },
    };
    const coarse = getSelectionInfo([text], ['text'], 1, undefined, true)!;

    // The top and bottom go the way every coarse edge handle does, but the
    // wrap-width gesture has no substitute among the corners, so it stays.
    expect(coarse.handles.map((h) => h.id).sort()).toEqual([
      'e',
      'ne',
      'nw',
      'se',
      'sw',
      'w',
    ]);
    // On a cursor the box carries the full set: every handle but `e`/`w` is
    // aspect-locked, so a vertical drag reads as a type scale.
    expect(getSelectionInfo([text], ['text'], 1)!.handles).toHaveLength(8);
  });

  it('paints the touch rotate knob far smaller than it is grabbed by', () => {
    const base = rectangle();
    const shape = { ...base, props: { ...base.props, w: 100, h: 60 } };
    const knob = getSelectionInfo([shape], [shape.id], 1, undefined, true)!
      .rotateHandle!;

    // A disc of a handle square's area, inside a fingertip-sized target.
    expect(knob.drawRadius).toBeCloseTo(8 / Math.sqrt(Math.PI));
    expect(knob.radius).toBe(20);
  });

  it('moves the rotate knob off a media shape\'s top edge', () => {
    const image: Extract<Shape, { type: 'image' }> = {
      id: 'image',
      type: 'image',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        blobId: 'blob',
        w: 100,
        h: 60,
        naturalWidth: 200,
        naturalHeight: 120,
      },
    };
    const info = getSelectionInfo([image], [image.id], 1, undefined, true)!;

    // A finger on the top edge covers the frame of the picture, so media takes
    // the lane below instead.
    expect(info.rotateHandle!.point.y).toBeGreaterThan(60);

    // Turned far enough that "below" has swung back up under the contextual
    // toolbar, it goes back to the box's own top edge. Measured in the box's
    // own frame, where the knob's lane is defined.
    const rotation = 1.9 * (Math.PI / 2);
    const turned = getSelectionInfo(
      [{ ...image, rotation }],
      [image.id],
      1,
      undefined,
      true,
    )!;
    const local = rotatePoint(turned.rotateHandle!.point, turned.center, -rotation);
    expect(local.y).toBeLessThan(0);
  });

  it('names the handle that stands where another does once the box turns', () => {
    expect(rotateResizeHandle('nw', 0)).toBe('nw');
    expect(rotateResizeHandle('nw', Math.PI / 2)).toBe('ne');
    expect(rotateResizeHandle('nw', Math.PI)).toBe('se');
    // Rounds to the nearest eighth turn, which is where the cursors are.
    expect(rotateResizeHandle('n', Math.PI / 4 - 0.01)).toBe('ne');
    expect(rotateResizeHandle('n', -Math.PI / 2)).toBe('w');

    // Which is what a rotated box's cursor *fallback* is picked with — the
    // keyword after the synthesized glyph, for anywhere the URI cannot load.
    expect(resizeCursor('nw', 0)).toContain(', nwse-resize');
    expect(resizeCursor('nw', Math.PI / 2)).toContain(', nesw-resize');
    expect(resizeCursor('e', Math.PI / 2)).toContain(', ns-resize');
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
    expect(info.rotateHandle).not.toBe(null);
  });
});
