import { distanceToSegment, type Point } from '@whiteboard/shared';
import { simplifyRDP } from './simplify';

/**
 * Hold-to-snap recognition: the clean shape a hand-drawn stroke was aiming
 * for, or null when it isn't clearly one.
 *
 * Pure geometry, run once when the pen dwells — no model, no network. Every
 * tolerance is a fraction of the stroke's bounding-box diagonal, so the same
 * triangle snaps the same way at any size and zoom.
 *
 * Polygons keep the corners the hand put down (a lopsided triangle stays
 * lopsided); only near-rectangles are squared up, because a "rectangle" with
 * 87° corners is never what anybody meant.
 */

/** Ends this close (of the diagonal) make the stroke a closed shape. */
const CLOSE_GAP = 0.2;
/** RDP tolerance used to find candidate corners. */
const CORNER_EPSILON = 0.05;
/** A vertex turning less than this is a wobble on an edge, not a corner. */
const MIN_TURN = (30 * Math.PI) / 180;
/** Edges shorter than this are a hook or overshoot and collapse to a point. */
const MIN_EDGE = 0.1;
/** Most corners a stroke may have and still be read as a polygon. */
const MAX_CORNERS = 6;
/** Mean distance from the stroke to the fitted shape, of the diagonal. */
const FIT_TOLERANCE = 0.035;
/** Farthest a stroke may stray from its chord and still be a line. */
const LINE_TOLERANCE = 0.04;
/** A quadrilateral whose corners are all this near 90° becomes a rectangle. */
const RIGHT_ANGLE_TOLERANCE = (15 * Math.PI) / 180;
/** An ellipse whose radii differ by less than this is drawn as a circle. */
const CIRCLE_TOLERANCE = 0.15;
/** Samples on a snapped ellipse. */
const ELLIPSE_SAMPLES = 72;
/** Lines and rectangles this near to an axis are laid on it. */
const AXIS_SNAP = (5 * Math.PI) / 180;

export function snapStroke(points: readonly Point[]): Point[] | null {
  if (points.length < 8) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag === 0) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(last.x - first.x, last.y - first.y) > CLOSE_GAP * diag) {
    return snapLine(points, first, last);
  }

  const polygon = fitPolygon(points, diag);
  const ellipse = fitEllipse(points, minX, minY, maxX, maxY);
  const polygonError = polygon ? meanRingDistance(points, polygon) / diag : Infinity;
  const ellipseError = ellipse.error / diag;
  if (Math.min(polygonError, ellipseError) > FIT_TOLERANCE) return null;
  if (polygon && polygonError <= ellipseError) {
    const ring = polygon.length === 4 ? squareUp(polygon) ?? polygon : polygon;
    return [...ring, ring[0]!];
  }
  return ellipse.ring(first);
}

function snapLine(points: readonly Point[], first: Point, last: Point): Point[] | null {
  const chord = Math.hypot(last.x - first.x, last.y - first.y);
  for (const p of points) {
    if (distanceToSegment(p, first, last) > LINE_TOLERANCE * chord) return null;
  }
  const angle = Math.atan2(last.y - first.y, last.x - first.x);
  const axis = Math.round(angle / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(angle - axis) > AXIS_SNAP) return [{ ...first }, { ...last }];
  return [
    { ...first },
    { x: first.x + Math.cos(axis) * chord, y: first.y + Math.sin(axis) * chord },
  ];
}

/** Turning angle at `b` walking a → b → c, in [0, π]. */
function turn(a: Point, b: Point, c: Point): number {
  const inAngle = Math.atan2(b.y - a.y, b.x - a.x);
  const outAngle = Math.atan2(c.y - b.y, c.x - b.x);
  let d = Math.abs(outAngle - inAngle);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Corners of the closed stroke, or null when it has too few or too many. */
function fitPolygon(points: readonly Point[], diag: number): Point[] | null {
  const ring = simplifyRDP(points as Point[], CORNER_EPSILON * diag)
    .slice(0, -1)
    .map((p) => ({ x: p.x, y: p.y }));

  // Collapse hooks, then drop the flattest vertex, until every survivor is a
  // real corner. The stroke's start usually sits mid-edge and goes here too.
  for (;;) {
    if (ring.length < 3) return null;
    const short = ring.findIndex((p, i) => {
      const q = ring[(i + 1) % ring.length]!;
      return Math.hypot(q.x - p.x, q.y - p.y) < MIN_EDGE * diag;
    });
    if (short !== -1) {
      const next = (short + 1) % ring.length;
      const a = ring[short]!;
      const b = ring[next]!;
      ring[short] = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      ring.splice(next, 1);
      continue;
    }
    let flattest = -1;
    let flattestTurn = MIN_TURN;
    ring.forEach((p, i) => {
      const t = turn(ring[(i - 1 + ring.length) % ring.length]!, p, ring[(i + 1) % ring.length]!);
      if (t < flattestTurn) {
        flattestTurn = t;
        flattest = i;
      }
    });
    if (flattest === -1) break;
    ring.splice(flattest, 1);
  }
  return ring.length <= MAX_CORNERS ? ring : null;
}

function meanRingDistance(points: readonly Point[], ring: Point[]): number {
  let total = 0;
  for (const p of points) {
    let best = Infinity;
    for (let i = 0; i < ring.length; i++) {
      best = Math.min(best, distanceToSegment(p, ring[i]!, ring[(i + 1) % ring.length]!));
    }
    total += best;
  }
  return total / points.length;
}

/**
 * The rectangle a near-rectangular quadrilateral was meant to be: oriented on
 * the mean of its edge directions, sized to the corners' extent along them.
 */
function squareUp(quad: Point[]): Point[] | null {
  let c = 0;
  let s = 0;
  for (let i = 0; i < 4; i++) {
    const a = quad[(i + 3) % 4]!;
    const b = quad[i]!;
    const n = quad[(i + 1) % 4]!;
    if (Math.abs(turn(a, b, n) - Math.PI / 2) > RIGHT_ANGLE_TOLERANCE) return null;
    // Edge directions agree modulo 90°, so average them on the 4θ circle.
    const angle = Math.atan2(n.y - b.y, n.x - b.x);
    c += Math.cos(4 * angle);
    s += Math.sin(4 * angle);
  }
  let theta = Math.atan2(s, c) / 4;
  if (Math.abs(theta) < AXIS_SNAP) theta = 0;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  // Extent in the rotated frame, then each original corner moves to the
  // nearest rectangle corner so the stroke's winding order is kept.
  const local = quad.map((p) => ({ u: p.x * cos + p.y * sin, v: -p.x * sin + p.y * cos }));
  const minU = Math.min(...local.map((p) => p.u));
  const maxU = Math.max(...local.map((p) => p.u));
  const minV = Math.min(...local.map((p) => p.v));
  const maxV = Math.max(...local.map((p) => p.v));
  const midU = (minU + maxU) / 2;
  const midV = (minV + maxV) / 2;
  return local.map(({ u, v }) => {
    const ru = u < midU ? minU : maxU;
    const rv = v < midV ? minV : maxV;
    return { x: ru * cos - rv * sin, y: ru * sin + rv * cos };
  });
}

/**
 * Axis-aligned ellipse on the stroke's bounding box, with its mean radial
 * error in world units.
 */
function fitEllipse(
  points: readonly Point[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
) {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  let rx = (maxX - minX) / 2;
  let ry = (maxY - minY) / 2;
  const mean = (rx + ry) / 2;
  let error = Infinity;
  if (rx > 0 && ry > 0) {
    let total = 0;
    for (const p of points) {
      total += Math.abs(Math.hypot((p.x - cx) / rx, (p.y - cy) / ry) - 1) * mean;
    }
    error = total / points.length;
  }
  if (Math.abs(rx - ry) < CIRCLE_TOLERANCE * Math.max(rx, ry)) rx = ry = mean;
  return {
    error,
    /** Sampled outline, starting where the stroke did. */
    ring(start: Point): Point[] {
      const from = Math.atan2((start.y - cy) / ry, (start.x - cx) / rx);
      return Array.from({ length: ELLIPSE_SAMPLES + 1 }, (_, i) => {
        const a = from + (i / ELLIPSE_SAMPLES) * 2 * Math.PI;
        return { x: cx + Math.cos(a) * rx, y: cy + Math.sin(a) * ry };
      });
    },
  };
}
