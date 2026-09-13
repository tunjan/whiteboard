import { describe, expect, it } from 'vitest';
import {
  allowedJumpBounds,
  boundsSize,
  contentPageBounds,
  dampToShapeBounds,
  fitPageBounds,
  minimapPointToPage,
  minimapZoom,
  snapToDominantAxis,
  viewportRadius,
} from './minimap-geometry';

const SCREEN = { width: 200, height: 120 };

describe('content page bounds', () => {
  it('always encloses the viewport, so clearing a page cannot collapse it', () => {
    const viewport = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    expect(contentPageBounds(null, viewport)).toEqual(viewport);
  });

  it('unions the drawing with the viewport', () => {
    const viewport = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    const shapes = { minX: -400, minY: 200, maxX: 100, maxY: 900 };
    expect(contentPageBounds(shapes, viewport)).toEqual({
      minX: -400,
      minY: 0,
      maxX: 800,
      maxY: 900,
    });
  });
});

describe('aspect fitting', () => {
  it('matches the minimap aspect ratio without cropping either axis', () => {
    const content = { minX: 0, minY: 0, maxX: 1000, maxY: 200 };
    const page = fitPageBounds(content, SCREEN);
    const size = boundsSize(page);

    expect(size.width / size.height).toBeCloseTo(SCREEN.width / SCREEN.height);
    expect(size.width).toBeGreaterThanOrEqual(1000);
    expect(size.height).toBeGreaterThanOrEqual(200);
  });

  it('grows the width when the content is taller than the minimap', () => {
    const content = { minX: 0, minY: 0, maxX: 100, maxY: 1000 };
    const page = fitPageBounds(content, SCREEN);
    const size = boundsSize(page);

    expect(size.height).toBeCloseTo(1000);
    expect(size.width).toBeCloseTo(1000 * (SCREEN.width / SCREEN.height));
  });

  it('keeps the content centred', () => {
    const content = { minX: 40, minY: -60, maxX: 240, maxY: 40 };
    const page = fitPageBounds(content, SCREEN);

    expect((page.minX + page.maxX) / 2).toBeCloseTo(140);
    expect((page.minY + page.maxY) / 2).toBeCloseTo(-10);
  });

  it('leaves a degenerate content box alone rather than dividing by zero', () => {
    const point = { minX: 5, minY: 5, maxX: 5, maxY: 5 };
    expect(fitPageBounds(point, SCREEN)).toEqual(point);
    expect(fitPageBounds(point, { width: 0, height: 0 })).toEqual(point);
    expect(minimapZoom(point, SCREEN)).toBe(0);
  });
});

describe('projection', () => {
  it('maps both axes at the one scale the fit guarantees', () => {
    const page = fitPageBounds(
      { minX: -100, minY: -100, maxX: 300, maxY: 100 },
      SCREEN,
    );
    const zoom = minimapZoom(page, SCREEN);
    const size = boundsSize(page);

    expect(zoom).toBeCloseTo(SCREEN.height / size.height);
  });

  it('round-trips a minimap offset through world space', () => {
    const page = fitPageBounds(
      { minX: -250, minY: 400, maxX: 750, maxY: 900 },
      SCREEN,
    );
    const zoom = minimapZoom(page, SCREEN);
    const offset = { x: 37, y: 91 };

    const world = minimapPointToPage(offset, page, SCREEN);
    expect((world.x - page.minX) * zoom).toBeCloseTo(offset.x);
    expect((world.y - page.minY) * zoom).toBeCloseTo(offset.y);
  });

  it('puts the minimap corners on the page corners', () => {
    const page = { minX: 10, minY: 20, maxX: 210, maxY: 140 };
    expect(minimapPointToPage({ x: 0, y: 0 }, page, SCREEN)).toEqual({
      x: 10,
      y: 20,
    });
    expect(
      minimapPointToPage({ x: SCREEN.width, y: SCREEN.height }, page, SCREEN),
    ).toEqual({ x: 210, y: 140 });
  });
});

describe('jump bounds', () => {
  it('extends half a viewport past the content on every side', () => {
    const content = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    expect(allowedJumpBounds(content, { width: 40, height: 20 })).toEqual({
      minX: -20,
      minY: -10,
      maxX: 120,
      maxY: 110,
    });
  });
});

describe('drag clamping', () => {
  const shapes = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  const viewport = { width: 200, height: 200 };

  it('leaves a target inside the drawing untouched', () => {
    expect(dampToShapeBounds({ x: 500, y: 500 }, shapes, viewport)).toEqual({
      x: 500,
      y: 500,
    });
  });

  it('never lets the centre leave the drawing plus half a viewport', () => {
    const far = dampToShapeBounds({ x: 99999, y: -99999 }, shapes, viewport);
    expect(far.x).toBeCloseTo(1100);
    expect(far.y).toBeCloseTo(-100);
  });

  it('halves an overshoot into the empty margin', () => {
    // Aiming a full viewport left of the drawing lands halfway there instead.
    const damped = dampToShapeBounds({ x: 0, y: 1000 }, shapes, viewport);
    expect(damped.x).toBeCloseTo(50);
    expect(damped.y).toBeCloseTo(950);
  });

  it('centres a drawing smaller than the viewport instead of pinning an edge', () => {
    const small = { minX: 400, minY: 400, maxX: 600, maxY: 600 };
    const wide = { width: 2000, height: 2000 };

    // Once the viewport is wider than the drawing, the two overflow terms are
    // both live across a band around the drawing's centre and cancel out to
    // exactly that centre — the small sketch sits in the middle of the screen
    // however sloppily it was aimed at.
    for (const target of [
      { x: -300, y: -300 },
      { x: 500, y: 500 },
      { x: 1300, y: 1300 },
    ]) {
      const out = dampToShapeBounds(target, small, wide);
      expect(out.x).toBeCloseTo(500);
      expect(out.y).toBeCloseTo(500);
    }
  });
});

describe('axis snapping', () => {
  const origin = { x: 100, y: 100 };

  it('holds y when the drag is mostly horizontal', () => {
    expect(snapToDominantAxis({ x: 400, y: 130 }, origin)).toEqual({
      x: 400,
      y: 100,
    });
  });

  it('holds x when the drag is mostly vertical, ties included', () => {
    expect(snapToDominantAxis({ x: 130, y: 400 }, origin)).toEqual({
      x: 100,
      y: 400,
    });
    expect(snapToDominantAxis({ x: 150, y: 150 }, origin)).toEqual({
      x: 100,
      y: 150,
    });
  });
});

describe('viewport corner radius', () => {
  it('drops the curve once the viewport rectangle is a few pixels across', () => {
    // 8 world units at 0.05 screen-px per unit is a 0.4px-wide indicator.
    expect(viewportRadius({ width: 8, height: 6 }, 0.05)).toBeNull();
  });

  it('caps the radius at four screen pixels', () => {
    const zoom = 0.5;
    expect(viewportRadius({ width: 4000, height: 3000 }, zoom)).toBeCloseTo(
      4 / zoom,
    );
  });

  it('never rounds more than a quarter of the shorter side', () => {
    const r = viewportRadius({ width: 100, height: 8 }, 1);
    expect(r).toBeCloseTo(2);
  });

  it('has no radius without a scale', () => {
    expect(viewportRadius({ width: 100, height: 100 }, 0)).toBeNull();
  });
});
