import { describe, expect, it } from 'vitest';
import { ellipseUtil } from './ellipse';
import { polygonUtil } from './polygon';

/**
 * Clicking a rounded or angled shape.
 *
 * Both of these used to hit-test as their bounding box, so a click anywhere in
 * the box selected the shape — including the corners, which for a circle are
 * the emptiest part of it and for a triangle are half the box. These cover the
 * corners specifically, plus the filled/unfilled split that decides whether the
 * interior counts, since that is what a marquee already distinguishes.
 */

const ellipse = (
  props: Partial<ReturnType<typeof ellipseUtil.getDefaultProps>> = {},
) => ({
  id: 'e1',
  type: 'ellipse' as const,
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: { ...ellipseUtil.getDefaultProps(), w: 100, h: 100, ...props },
});

const polygon = (
  props: Partial<ReturnType<typeof polygonUtil.getDefaultProps>> = {},
) => ({
  id: 'p1',
  type: 'polygon' as const,
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: { ...polygonUtil.getDefaultProps(), w: 100, h: 100, ...props },
});

describe('clicking an ellipse', () => {
  it('ignores the corners of its bounding box', () => {
    const s = ellipse({ fillStyle: 'solid' });
    expect(ellipseUtil.hitTest(s, { x: 50, y: 50 }, 0)).toBe(true);
    expect(ellipseUtil.hitTest(s, { x: 2, y: 2 }, 0)).toBe(false);
    expect(ellipseUtil.hitTest(s, { x: 98, y: 98 }, 0)).toBe(false);
  });

  it('hits the stroke but not the interior when unfilled', () => {
    const s = ellipse({ fillStyle: 'none', size: 2 });
    expect(ellipseUtil.hitTest(s, { x: 50, y: 0 }, 0)).toBe(true);
    expect(ellipseUtil.hitTest(s, { x: 50, y: 50 }, 0)).toBe(false);
  });

  it('hits the interior when filled', () => {
    expect(
      ellipseUtil.hitTest(ellipse({ fillStyle: 'solid' }), { x: 50, y: 50 }, 0),
    ).toBe(true);
  });

  it('counts a hatch fill as filled, so the gaps between lines still hit', () => {
    expect(
      ellipseUtil.hitTest(ellipse({ fillStyle: 'hatch' }), { x: 50, y: 50 }, 0),
    ).toBe(true);
  });

  it('widens the target by the tolerance and by half the stroke width', () => {
    const thin = ellipse({ fillStyle: 'none', size: 2 });
    expect(ellipseUtil.hitTest(thin, { x: 50, y: -6 }, 0)).toBe(false);
    expect(ellipseUtil.hitTest(thin, { x: 50, y: -6 }, 6)).toBe(true);

    // The same point, reached by the stroke growing rather than the tolerance.
    expect(ellipseUtil.hitTest(ellipse({ fillStyle: 'none', size: 14 }), { x: 50, y: -6 }, 0)).toBe(
      true,
    );
  });

  it('follows the shape when it is rotated', () => {
    // A 2:1 ellipse turned upright: the point off its (former) long axis is now
    // outside it, and the point off its short axis is now inside.
    const upright = ellipse({ fillStyle: 'solid', w: 200, h: 100 });
    const turned = { ...upright, rotation: Math.PI / 2 };
    expect(ellipseUtil.hitTest(upright, { x: 190, y: 50 }, 0)).toBe(true);
    expect(ellipseUtil.hitTest(turned, { x: 190, y: 50 }, 0)).toBe(false);
  });
});

describe('clicking a polygon', () => {
  it('ignores the corners a triangle does not reach into', () => {
    const s = polygon({ kind: 'triangle', fillStyle: 'solid' });
    expect(polygonUtil.hitTest(s, { x: 50, y: 50 }, 0)).toBe(true);
    expect(polygonUtil.hitTest(s, { x: 2, y: 2 }, 0)).toBe(false);
    expect(polygonUtil.hitTest(s, { x: 98, y: 2 }, 0)).toBe(false);
  });

  it('keeps the corners a rectangle-shaped kind does reach into', () => {
    // A trapezoid fills the bottom corners of its box but not the top ones.
    const s = polygon({ kind: 'trapezoid', fillStyle: 'solid' });
    expect(polygonUtil.hitTest(s, { x: 2, y: 98 }, 0)).toBe(true);
    expect(polygonUtil.hitTest(s, { x: 2, y: 2 }, 0)).toBe(false);
  });

  it('hits the outline but not the interior when unfilled', () => {
    const s = polygon({ kind: 'diamond', fillStyle: 'none', size: 2 });
    expect(polygonUtil.hitTest(s, { x: 50, y: 0 }, 0)).toBe(true);
    expect(polygonUtil.hitTest(s, { x: 50, y: 50 }, 0)).toBe(false);
  });

  it('follows the shape when it is rotated', () => {
    // Turned half a turn, a triangle's apex points down and its base runs along
    // the top of the box, so the two corners that are empty swap ends.
    const s = polygon({ kind: 'triangle', fillStyle: 'solid' });
    const flipped = { ...s, rotation: Math.PI };
    expect(polygonUtil.hitTest(s, { x: 5, y: 5 }, 0)).toBe(false);
    expect(polygonUtil.hitTest(flipped, { x: 5, y: 5 }, 0)).toBe(true);
    expect(polygonUtil.hitTest(s, { x: 5, y: 95 }, 0)).toBe(true);
    expect(polygonUtil.hitTest(flipped, { x: 5, y: 95 }, 0)).toBe(false);
  });
});
