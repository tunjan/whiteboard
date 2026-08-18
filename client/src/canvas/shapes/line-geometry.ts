import {
  type ArrowTopology,
  type Bounds,
  type LineSpline,
  type Point,
  type Vec,
  distance,
  distanceToSegment,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';

// Shared geometry for line and arrow shapes. Points are stored in shape-local
// coordinates; every renderer, hit-test, snap target and handle uses the same
// sampled path so the visible and interactive geometry cannot drift apart.

const BEND_EPSILON = 0.5;
const ARC_SAMPLES = 32;
const SPLINE_SAMPLES_PER_SEGMENT = 12;
const TAU = Math.PI * 2;

export function polylineBounds(
  x: number,
  y: number,
  points: readonly Vec[],
  pad: number,
): Bounds {
  const b = pointsBounds(points);
  return {
    minX: x + b.minX - pad,
    minY: y + b.minY - pad,
    maxX: x + b.maxX + pad,
    maxY: y + b.maxY + pad,
  };
}

export function polylineHitTest(
  x: number,
  y: number,
  rotation: number,
  points: readonly Vec[],
  p: Point,
  tolerance: number,
  sizeHalf: number,
): boolean {
  if (points.length === 0) return false;
  const b = pointsBounds(points);
  const center = {
    x: x + (b.minX + b.maxX) / 2,
    y: y + (b.minY + b.maxY) / 2,
  };
  const wp = rotation ? rotatePoint(p, center, -rotation) : p;
  const local = { x: wp.x - x, y: wp.y - y };
  const r = tolerance + sizeHalf;
  if (points.length === 1) return distance(local, points[0]!) <= r;
  for (let i = 0; i < points.length - 1; i++) {
    if (distanceToSegment(local, points[i]!, points[i + 1]!) <= r) {
      return true;
    }
  }
  return false;
}

/** SVG transform for a polyline shape (translate + optional rotation). */
export function polylineTransform(
  x: number,
  y: number,
  points: readonly Vec[],
  rotation: number,
): string {
  let transform = `translate(${x} ${y})`;
  if (rotation) {
    const b = pointsBounds(points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    transform += ` rotate(${(rotation * 180) / Math.PI} ${cx} ${cy})`;
  }
  return transform;
}

/** SVG path through a set of vertices. */
export function polylinePath(points: readonly Vec[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
}

/** Unit perpendicular to the chord a -> b (rotated +90 degrees). */
function chordPerp(a: Vec, b: Vec): Vec {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: -dy / len, y: dx / len };
}

/** Visible apex of a symmetric two-point arc. */
export function curveApex(a: Vec, b: Vec, bend: number): Vec {
  const n = chordPerp(a, b);
  return {
    x: (a.x + b.x) / 2 + n.x * bend,
    y: (a.y + b.y) / 2 + n.y * bend,
  };
}

/** Signed bend implied by dragging the arc apex to p. */
export function bendFromPoint(a: Vec, b: Vec, p: Vec): number {
  const n = chordPerp(a, b);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (p.x - mx) * n.x + (p.y - my) * n.y;
}

interface CircularArc {
  center: Vec;
  radius: number;
  startAngle: number;
  /** Signed SVG-space sweep. Positive angles run clockwise because y grows down. */
  delta: number;
}

function positiveAngle(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

/** Circle passing through endpoints and the user-facing bend apex. */
export function circularArc(a: Vec, b: Vec, bend: number): CircularArc | null {
  if (Math.abs(bend) < BEND_EPSILON || distance(a, b) < BEND_EPSILON) {
    return null;
  }
  const c = curveApex(a, b, bend);
  const determinant =
    2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(determinant) < 1e-8) return null;

  const aa = a.x * a.x + a.y * a.y;
  const bb = b.x * b.x + b.y * b.y;
  const cc = c.x * c.x + c.y * c.y;
  const center = {
    x: (aa * (b.y - c.y) + bb * (c.y - a.y) + cc * (a.y - b.y)) / determinant,
    y: (aa * (c.x - b.x) + bb * (a.x - c.x) + cc * (b.x - a.x)) / determinant,
  };
  const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
  const endAngle = Math.atan2(b.y - center.y, b.x - center.x);
  const apexAngle = Math.atan2(c.y - center.y, c.x - center.x);
  const clockwiseToEnd = positiveAngle(endAngle - startAngle);
  const clockwiseToApex = positiveAngle(apexAngle - startAngle);
  const delta =
    clockwiseToApex <= clockwiseToEnd + 1e-7
      ? clockwiseToEnd
      : -(TAU - clockwiseToEnd);
  const radius = distance(a, center);
  if (!Number.isFinite(radius) || radius > 1e7) return null;
  return { center, radius, startAngle, delta };
}

function pointOnArc(arc: CircularArc, t: number): Vec {
  const angle = arc.startAngle + arc.delta * t;
  return {
    x: arc.center.x + Math.cos(angle) * arc.radius,
    y: arc.center.y + Math.sin(angle) * arc.radius,
  };
}

function arcPath(a: Vec, b: Vec, bend: number): string | null {
  const arc = circularArc(a, b, bend);
  if (!arc) return null;
  return `M ${a.x} ${a.y} A ${arc.radius} ${arc.radius} 0 ${
    Math.abs(arc.delta) > Math.PI ? 1 : 0
  } ${arc.delta > 0 ? 1 : 0} ${b.x} ${b.y}`;
}

function sampleArc(a: Vec, b: Vec, bend: number): Vec[] | null {
  const arc = circularArc(a, b, bend);
  if (!arc) return null;
  return Array.from({ length: ARC_SAMPLES + 1 }, (_, i) =>
    pointOnArc(arc, i / ARC_SAMPLES),
  );
}

interface CubicSegment {
  a: Vec;
  c1: Vec;
  c2: Vec;
  b: Vec;
}

/** Natural C2 cubic Hermite interpolation through every vertex. */
function naturalSplineSegments(points: readonly Vec[]): CubicSegment[] {
  const n = points.length;
  if (n < 2) return [];
  if (n === 2) {
    const a = points[0]!;
    const b = points[1]!;
    return [
      {
        a,
        c1: { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 },
        c2: { x: a.x + ((b.x - a.x) * 2) / 3, y: a.y + ((b.y - a.y) * 2) / 3 },
        b,
      },
    ];
  }

  const lower = new Array<number>(n).fill(1);
  const diagonal = new Array<number>(n).fill(4);
  const upper = new Array<number>(n).fill(1);
  const rhsX = new Array<number>(n);
  const rhsY = new Array<number>(n);
  lower[0] = 0;
  diagonal[0] = 2;
  upper[n - 1] = 0;
  diagonal[n - 1] = 2;
  rhsX[0] = 3 * (points[1]!.x - points[0]!.x);
  rhsY[0] = 3 * (points[1]!.y - points[0]!.y);
  for (let i = 1; i < n - 1; i++) {
    rhsX[i] = 3 * (points[i + 1]!.x - points[i - 1]!.x);
    rhsY[i] = 3 * (points[i + 1]!.y - points[i - 1]!.y);
  }
  rhsX[n - 1] = 3 * (points[n - 1]!.x - points[n - 2]!.x);
  rhsY[n - 1] = 3 * (points[n - 1]!.y - points[n - 2]!.y);

  for (let i = 1; i < n; i++) {
    const factor = lower[i]! / diagonal[i - 1]!;
    diagonal[i] = diagonal[i]! - factor * upper[i - 1]!;
    rhsX[i] = rhsX[i]! - factor * rhsX[i - 1]!;
    rhsY[i] = rhsY[i]! - factor * rhsY[i - 1]!;
  }
  const derivatives = new Array<Vec>(n);
  derivatives[n - 1] = {
    x: rhsX[n - 1]! / diagonal[n - 1]!,
    y: rhsY[n - 1]! / diagonal[n - 1]!,
  };
  for (let i = n - 2; i >= 0; i--) {
    derivatives[i] = {
      x: (rhsX[i]! - upper[i]! * derivatives[i + 1]!.x) / diagonal[i]!,
      y: (rhsY[i]! - upper[i]! * derivatives[i + 1]!.y) / diagonal[i]!,
    };
  }

  return points.slice(0, -1).map((a, i) => {
    const b = points[i + 1]!;
    const da = derivatives[i]!;
    const db = derivatives[i + 1]!;
    return {
      a,
      c1: { x: a.x + da.x / 3, y: a.y + da.y / 3 },
      c2: { x: b.x - db.x / 3, y: b.y - db.y / 3 },
      b,
    };
  });
}

function cubicPoint(segment: CubicSegment, t: number): Vec {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x:
      mt2 * mt * segment.a.x +
      3 * mt2 * t * segment.c1.x +
      3 * mt * t2 * segment.c2.x +
      t2 * t * segment.b.x,
    y:
      mt2 * mt * segment.a.y +
      3 * mt2 * t * segment.c1.y +
      3 * mt * t2 * segment.c2.y +
      t2 * t * segment.b.y,
  };
}

function splinePath(points: readonly Vec[]): string {
  const segments = naturalSplineSegments(points);
  if (!segments.length) return '';
  return `M ${segments[0]!.a.x} ${segments[0]!.a.y} ${segments
    .map(
      (segment) =>
        `C ${segment.c1.x} ${segment.c1.y} ${segment.c2.x} ${segment.c2.y} ${segment.b.x} ${segment.b.y}`,
    )
    .join(' ')}`;
}

function sampleSpline(points: readonly Vec[]): Vec[] {
  const out: Vec[] = [];
  for (const [index, segment] of naturalSplineSegments(points).entries()) {
    for (let i = index === 0 ? 0 : 1; i <= SPLINE_SAMPLES_PER_SEGMENT; i++) {
      out.push(cubicPoint(segment, i / SPLINE_SAMPLES_PER_SEGMENT));
    }
  }
  return out;
}

/** Flatten a line for bounds, snapping and hit-testing. */
export function curvePoints(
  points: readonly Vec[],
  bend: number,
  spline: LineSpline = 'linear',
): Vec[] {
  if (points.length < 2) return [...points];
  if (points.length === 2 && Math.abs(bend) >= BEND_EPSILON) {
    return sampleArc(points[0]!, points[1]!, bend) ?? [...points];
  }
  return spline === 'smooth' && points.length > 2
    ? sampleSpline(points)
    : [...points];
}

/** SVG path for a straight, circular-arc, polyline, or natural spline line. */
export function curvePath(
  points: readonly Vec[],
  bend: number,
  spline: LineSpline = 'linear',
): string {
  if (points.length < 2) return '';
  if (points.length === 2 && Math.abs(bend) >= BEND_EPSILON) {
    return arcPath(points[0]!, points[1]!, bend) ?? polylinePath(points);
  }
  return spline === 'smooth' && points.length > 2
    ? splinePath(points)
    : polylinePath(points);
}

/** Flatten an arrow body according to its topology. */
export function arrowPoints(
  points: readonly Vec[],
  topology: ArrowTopology,
  bend: number,
): Vec[] {
  if (points.length < 2) return [...points];
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (topology === 'arc') return sampleArc(a, b, bend) ?? [a, b];
  if (topology === 'straight') return [a, b];
  return [...points];
}

/** SVG path for an arrow body according to its topology. */
export function arrowPath(
  points: readonly Vec[],
  topology: ArrowTopology,
  bend: number,
): string {
  if (points.length < 2) return '';
  const a = points[0]!;
  const b = points[points.length - 1]!;
  if (topology === 'arc') return arcPath(a, b, bend) ?? polylinePath([a, b]);
  if (topology === 'straight') return polylinePath([a, b]);
  return polylinePath(points);
}

/** Position of the create handle halfway along a source segment. */
export function segmentMidpoint(
  points: readonly Vec[],
  index: number,
  bend: number,
  spline: LineSpline,
): Vec {
  const a = points[index]!;
  const b = points[index + 1]!;
  if (points.length === 2 && Math.abs(bend) >= BEND_EPSILON) {
    const arc = circularArc(a, b, bend);
    if (arc) return pointOnArc(arc, 0.5);
  }
  if (spline === 'smooth' && points.length > 2) {
    const segment = naturalSplineSegments(points)[index];
    if (segment) return cubicPoint(segment, 0.5);
  }
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Arc-length midpoint and local tangent of a sampled path. */
export function pathMidpoint(points: readonly Vec[]): {
  point: Vec;
  tangent: Vec;
} {
  const first = points[0] ?? { x: 0, y: 0 };
  if (points.length < 2) return { point: first, tangent: { x: 1, y: 0 } };
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const length = distance(points[i]!, points[i + 1]!);
    lengths.push(length);
    total += length;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    const length = lengths[i]!;
    if (remaining <= length || i === lengths.length - 1) {
      const a = points[i]!;
      const b = points[i + 1]!;
      const t = length > 0 ? remaining / length : 0;
      return {
        point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
        tangent: { x: b.x - a.x, y: b.y - a.y },
      };
    }
    remaining -= length;
  }
  return { point: first, tangent: { x: 1, y: 0 } };
}

/** A nearby point that defines the terminal tangent for arrowhead orientation. */
export function tangentAnchor(points: readonly Vec[], atStart: boolean): Vec {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  return atStart ? points[1]! : points[points.length - 2]!;
}

/** Scale a polyline to fit newBounds, including its local origin. */
export function resizePolyline(
  points: readonly Vec[],
  pad: number,
  newBounds: Bounds,
): { x: number; y: number; points: Vec[]; scale: number } {
  const original = pointsBounds(points);
  const initialWidth = original.maxX - original.minX + 2 * pad || 1;
  const initialHeight = original.maxY - original.minY + 2 * pad || 1;
  const sx = (newBounds.maxX - newBounds.minX) / initialWidth;
  const sy = (newBounds.maxY - newBounds.minY) / initialHeight;
  const scaled = points.map((point) => ({ x: point.x * sx, y: point.y * sy }));
  const bounds = pointsBounds(scaled);
  return {
    x: newBounds.minX - (bounds.minX - pad),
    y: newBounds.minY - (bounds.minY - pad),
    points: scaled,
    scale: (Math.abs(sx) + Math.abs(sy)) / 2,
  };
}

/** Length of a terminal decoration for a given stroke width. */
export function arrowheadLength(size: number): number {
  return Math.max(8, size * 3.5);
}

/** Generate an open arrowhead at to, oriented away from the interior point from. */
export function arrowheadPath(from: Vec, to: Vec, size: number): string {
  return polylinePath(arrowheadPoints(from, to, size));
}

/** Open arrowhead vertices, shared by exact and synthesized renderers. */
export function arrowheadPoints(
  from: Vec,
  to: Vec,
  size: number,
): [Vec, Vec, Vec] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const magnitude = Math.hypot(dx, dy) || 1;
  const ux = dx / magnitude;
  const uy = dy / magnitude;
  const nx = -uy;
  const ny = ux;
  const length = arrowheadLength(size);
  const back = { x: to.x - ux * length, y: to.y - uy * length };
  const wing = length * Math.sin(Math.PI / 6);
  const left = { x: back.x + nx * wing, y: back.y + ny * wing };
  const right = { x: back.x - nx * wing, y: back.y - ny * wing };
  return [left, to, right];
}
