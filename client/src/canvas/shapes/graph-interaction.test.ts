import { describe, expect, it } from 'vitest';
import type { GraphViewport } from '@whiteboard/shared';
import {
  type PlotArea,
  graphToScreen,
  panViewport,
  screenToGraph,
  zoomViewport,
} from './graph-interaction';

const viewport: GraphViewport = { xMin: -10, xMax: 10, yMin: -6, yMax: 6 };
// 200×120 plot at world origin → 10 world px per x-unit, 10 per y-unit.
const area: PlotArea = { x: 0, y: 0, w: 200, h: 120 };

describe('screenToGraph', () => {
  it('maps the plot center to the math center', () => {
    const p = screenToGraph({ x: 100, y: 60 }, viewport, area);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(0);
  });

  it('inverts the top-left corner (y is flipped)', () => {
    const p = screenToGraph({ x: 0, y: 0 }, viewport, area);
    expect(p.x).toBeCloseTo(-10);
    expect(p.y).toBeCloseTo(6);
  });
});

describe('graphToScreen', () => {
  it('maps the math center to the plot center', () => {
    const p = graphToScreen({ x: 0, y: 0 }, viewport, area);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(60);
  });

  it('round-trips through screenToGraph', () => {
    for (const point of [
      { x: -7.5, y: 4 },
      { x: 0, y: 0 },
      { x: 9.9, y: -5.5 },
    ]) {
      const back = screenToGraph(
        graphToScreen(point, viewport, area),
        viewport,
        area,
      );
      expect(back.x).toBeCloseTo(point.x);
      expect(back.y).toBeCloseTo(point.y);
    }
  });
});

describe('zoomViewport', () => {
  it('keeps the anchor point fixed when zooming in', () => {
    const anchor = { x: 150, y: 30 };
    const before = screenToGraph(anchor, viewport, area);
    const next = zoomViewport(viewport, area, anchor, 0.5);
    const after = screenToGraph(anchor, next, area);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('halves the ranges with factor 0.5', () => {
    const next = zoomViewport(viewport, area, { x: 100, y: 60 }, 0.5);
    expect(next.xMax - next.xMin).toBeCloseTo(10);
    expect(next.yMax - next.yMin).toBeCloseTo(6);
  });

  it('zooming about the center stays centered', () => {
    const next = zoomViewport(viewport, area, { x: 100, y: 60 }, 0.5);
    expect((next.xMin + next.xMax) / 2).toBeCloseTo(0);
    expect((next.yMin + next.yMax) / 2).toBeCloseTo(0);
  });
});

describe('panViewport', () => {
  it('moves the window right for a positive x delta', () => {
    const next = panViewport(viewport, area, 20, 0);
    // 20 world px = 2 math units (10 px/unit).
    expect(next.xMin).toBeCloseTo(-8);
    expect(next.xMax).toBeCloseTo(12);
    expect(next.yMin).toBeCloseTo(-6);
  });

  it('moves the window down (math decreases) for a positive y delta', () => {
    const next = panViewport(viewport, area, 0, 12);
    // 12 world px = 1.2 math units (10 px/unit on y: 120px / 12 units).
    expect(next.yMin).toBeCloseTo(-7.2);
    expect(next.yMax).toBeCloseTo(4.8);
  });
});
