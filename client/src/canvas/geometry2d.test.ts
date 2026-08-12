import { describe, expect, it } from 'vitest';
import {
  Circle2d,
  Polygon2d,
  Polyline2d,
  Rectangle2d,
  nearestPointOnSegment,
  polygonsIntersect,
  segmentsIntersect,
} from './geometry2d';

const rect = (x: number, y: number, w: number, h: number) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

describe('nearestPointOnSegment', () => {
  it('clamps to the segment endpoints', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 10, y: 0 };
    expect(nearestPointOnSegment({ x: -5, y: 3 }, a, b)).toEqual({ x: 0, y: 0 });
    expect(nearestPointOnSegment({ x: 50, y: 3 }, a, b)).toEqual({ x: 10, y: 0 });
    expect(nearestPointOnSegment({ x: 4, y: 9 }, a, b)).toEqual({ x: 4, y: 0 });
  });

  it('handles a degenerate zero-length segment', () => {
    const a = { x: 2, y: 2 };
    expect(nearestPointOnSegment({ x: 9, y: 9 }, a, a)).toEqual({ x: 2, y: 2 });
  });
});

describe('segmentsIntersect', () => {
  it('detects a crossing', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toBe(true);
  });

  it('rejects non-crossing segments', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 5, y: 5 }, { x: 6, y: 6 }),
    ).toBe(false);
  });

  it('counts a touching endpoint as an intersection', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }),
    ).toBe(true);
  });
});

describe('polygonsIntersect', () => {
  it('detects overlapping rectangles', () => {
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(5, 5, 10, 10))).toBe(true);
  });

  it('finds a separating axis for disjoint rectangles', () => {
    expect(polygonsIntersect(rect(0, 0, 10, 10), rect(100, 0, 10, 10))).toBe(false);
  });

  it('detects full containment', () => {
    expect(polygonsIntersect(rect(0, 0, 100, 100), rect(10, 10, 5, 5))).toBe(true);
  });

  it('finds the diagonal separating axis a bounds-only test would miss', () => {
    // Two diamonds whose AABBs overlap but whose bodies do not.
    const diamond = (cx: number, cy: number) => [
      { x: cx, y: cy - 5 },
      { x: cx + 5, y: cy },
      { x: cx, y: cy + 5 },
      { x: cx - 5, y: cy },
    ];
    expect(polygonsIntersect(diamond(0, 0), diamond(9, 9))).toBe(false);
  });

  it('is false for an empty polygon', () => {
    expect(polygonsIntersect([], rect(0, 0, 1, 1))).toBe(false);
  });
});

describe('Rectangle2d', () => {
  it('reports its four corners and bounds', () => {
    const r = new Rectangle2d(10, 20, 30, 40);
    expect(r.getVertices()).toEqual([
      { x: 10, y: 20 },
      { x: 40, y: 20 },
      { x: 40, y: 60 },
      { x: 10, y: 60 },
    ]);
    expect(r.getBounds()).toEqual({ minX: 10, minY: 20, maxX: 40, maxY: 60 });
  });

  it('hits the interior only when filled', () => {
    const inside = { x: 5, y: 5 };
    expect(new Rectangle2d(0, 0, 10, 10, { isFilled: true }).hitTestPoint(inside)).toBe(true);
    expect(new Rectangle2d(0, 0, 10, 10).hitTestPoint(inside)).toBe(false);
  });

  it('hits near the outline of an unfilled rect within the margin', () => {
    const r = new Rectangle2d(0, 0, 10, 10);
    expect(r.hitTestPoint({ x: 5, y: 0.5 }, 1)).toBe(true);
    expect(r.hitTestPoint({ x: 5, y: 3 }, 1)).toBe(false);
  });

  it('measures distance to the nearest edge from outside', () => {
    const r = new Rectangle2d(0, 0, 10, 10, { isFilled: true });
    expect(r.distanceToPoint({ x: -4, y: 5 })).toBeCloseTo(4);
    expect(r.distanceToPoint({ x: 5, y: 5 })).toBe(0);
  });
});

describe('Circle2d', () => {
  it('projects the nearest point onto the boundary', () => {
    const c = new Circle2d(0, 0, 5);
    expect(c.nearestPoint({ x: 10, y: 0 })).toEqual({ x: 5, y: 0 });
    const diag = c.nearestPoint({ x: 10, y: 10 });
    expect(Math.hypot(diag.x, diag.y)).toBeCloseTo(5);
  });

  it('picks a boundary point at the exact center rather than dividing by zero', () => {
    expect(new Circle2d(3, 4, 2).nearestPoint({ x: 3, y: 4 })).toEqual({ x: 5, y: 4 });
  });

  it('treats the interior as inside only when filled', () => {
    const center = { x: 0, y: 0 };
    expect(new Circle2d(0, 0, 5, { isFilled: true }).distanceToPoint(center)).toBe(0);
    expect(new Circle2d(0, 0, 5).distanceToPoint(center)).toBeCloseTo(5);
  });

  it('uses exact bounds, not the polygonal approximation', () => {
    expect(new Circle2d(10, 10, 5).getBounds()).toEqual({
      minX: 5,
      minY: 5,
      maxX: 15,
      maxY: 15,
    });
  });

  it('measures distance to the boundary from outside', () => {
    expect(new Circle2d(0, 0, 5, { isFilled: true }).distanceToPoint({ x: 9, y: 0 })).toBeCloseTo(4);
  });
});

describe('Polygon2d', () => {
  const triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 5, y: 10 },
  ];

  it('hit-tests the interior of a filled polygon', () => {
    const p = new Polygon2d(triangle, { isFilled: true });
    expect(p.hitTestPoint({ x: 5, y: 3 })).toBe(true);
    expect(p.hitTestPoint({ x: 0, y: 9 })).toBe(false);
  });

  it('closes the ring when finding the nearest point', () => {
    // The closing edge runs from (5,10) back to (0,0); a point just outside it
    // must snap onto that edge rather than to a vertex.
    const p = new Polygon2d(triangle);
    const near = p.nearestPoint({ x: 1, y: 4 });
    expect(p.distanceToPoint({ x: 1, y: 4 })).toBeLessThan(distanceTo(near, { x: 0, y: 0 }) + 1);
  });

  it('handles a non-convex polygon interior correctly', () => {
    // An L-shape: the notch must not count as inside.
    const l = new Polygon2d(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 4 },
        { x: 4, y: 4 },
        { x: 4, y: 10 },
        { x: 0, y: 10 },
      ],
      { isFilled: true },
    );
    expect(l.hitTestPoint({ x: 2, y: 2 })).toBe(true);
    expect(l.hitTestPoint({ x: 8, y: 8 })).toBe(false);
  });

  it('intersects a marquee that overlaps it', () => {
    const p = new Polygon2d(triangle, { isFilled: true });
    expect(p.intersectsPolygon(rect(4, 4, 2, 2))).toBe(true);
    expect(p.intersectsPolygon(rect(100, 100, 2, 2))).toBe(false);
  });
});

describe('Polyline2d', () => {
  const line = new Polyline2d([
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ]);

  it('measures distance to the chain, not the closing edge', () => {
    // A closed ring would run an edge from (10,10) back to (0,0), passing close
    // to (5,5). An open chain must stay ~5 away.
    expect(line.distanceToPoint({ x: 5, y: 5 })).toBeCloseTo(5);
  });

  it('hit-tests within a margin of the chain', () => {
    expect(line.hitTestPoint({ x: 5, y: 1 }, 2)).toBe(true);
    expect(line.hitTestPoint({ x: 5, y: 4 }, 2)).toBe(false);
  });

  it('is never filled', () => {
    expect(line.isFilled).toBe(false);
    expect(line.isClosed).toBe(false);
  });

  it('intersects a marquee crossing one of its segments', () => {
    expect(line.intersectsPolygon(rect(4, -1, 2, 2))).toBe(true);
  });

  it('intersects a marquee that fully contains a vertex', () => {
    expect(line.intersectsPolygon(rect(-1, -1, 3, 3))).toBe(true);
  });

  it('does not intersect a marquee sitting in its concave gap', () => {
    // (5,5) is inside the triangle the chain would close, but off the chain.
    expect(line.intersectsPolygon(rect(4, 4, 2, 2))).toBe(false);
  });

  it('survives a single-point chain', () => {
    const dot = new Polyline2d([{ x: 3, y: 3 }]);
    expect(dot.nearestPoint({ x: 0, y: 0 })).toEqual({ x: 3, y: 3 });
    expect(dot.distanceToPoint({ x: 3, y: 3 })).toBe(0);
  });

  it('survives an empty chain', () => {
    const empty = new Polyline2d([]);
    expect(empty.nearestPoint({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(empty.intersectsPolygon(rect(0, 0, 10, 10))).toBe(false);
  });
});

function distanceTo(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
