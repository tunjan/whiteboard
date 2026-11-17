import type { PolygonKind, Vec } from '@whiteboard/shared';
import { rng } from './geometry-synthesis';
import { BASE_STROKE_WIDTH } from './style';

function regular(n: number): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    pts.push({ x: 0.5 + 0.5 * Math.cos(a), y: 0.5 + 0.5 * Math.sin(a) });
  }
  return pts;
}

/** A five-pointed star: points on the unit circle, valleys on a smaller one. */
function star(): Vec[] {
  const pts: Vec[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 ? 0.5 * 0.382 : 0.5;
    pts.push({ x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) });
  }
  return pts;
}

/** Vertices per cloud bump; every this-many-th vertex is a cusp. */
export const CLOUD_BUMP_SAMPLES = 8;

/** Bump width at stroke sizes s, m, l and xl (2, 3.5, 5, 10), as in tldraw. */
const BUMP_WIDTHS: [size: number, width: number][] = [
  [2, 50],
  [3.5, 70],
  [5, 100],
  [10, 130],
];

function bumpWidth(size: number): number {
  const [first] = BUMP_WIDTHS;
  if (size <= first![0]) return first![1];
  for (let i = 1; i < BUMP_WIDTHS.length; i++) {
    const [s0, w0] = BUMP_WIDTHS[i - 1]!;
    const [s1, w1] = BUMP_WIDTHS[i]!;
    if (size <= s1) return w0 + ((size - s0) / (s1 - s0)) * (w1 - w0);
  }
  return BUMP_WIDTHS[BUMP_WIDTHS.length - 1]![1];
}

function pillPerimeter(w: number, h: number): number {
  const r = Math.min(w, h) / 2;
  return 2 * (Math.max(w, h) - 2 * r) + 2 * Math.PI * r;
}

/** `n` evenly spaced points clockwise round a w x h pill, from its top-left. */
function pillPoints(w: number, h: number, n: number): Vec[] {
  const r = Math.min(w, h) / 2;
  const sx = w - 2 * r;
  const sy = h - 2 * r;
  // Straight runs and quarter turns, clockwise from the top edge.
  const runs: ((t: number) => Vec)[] = [];
  const lengths: number[] = [];
  const corners = [
    { x: w - r, y: r },
    { x: w - r, y: h - r },
    { x: r, y: h - r },
    { x: r, y: r },
  ];
  const edges = [
    { from: { x: r, y: 0 }, dx: 1, dy: 0, len: sx },
    { from: { x: w, y: r }, dx: 0, dy: 1, len: sy },
    { from: { x: w - r, y: h }, dx: -1, dy: 0, len: sx },
    { from: { x: 0, y: h - r }, dx: 0, dy: -1, len: sy },
  ];
  edges.forEach((e, i) => {
    runs.push((t) => ({ x: e.from.x + e.dx * t, y: e.from.y + e.dy * t }));
    lengths.push(e.len);
    const c = corners[i]!;
    const a0 = -Math.PI / 2 + (i * Math.PI) / 2;
    runs.push((t) => ({
      x: c.x + r * Math.cos(a0 + t / r),
      y: c.y + r * Math.sin(a0 + t / r),
    }));
    lengths.push((Math.PI / 2) * r);
  });
  const step = pillPerimeter(w, h) / n;
  const pts: Vec[] = [];
  let run = 0;
  let along = 0;
  for (let i = 0; i < n; i++) {
    while (along > lengths[run]! && run < runs.length - 1) {
      along -= lengths[run]!;
      run++;
    }
    pts.push(runs[run]!(Math.min(along, lengths[run]!)));
    along += step;
  }
  return pts;
}

function circleThrough(a: Vec, b: Vec, c: Vec): Vec | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  return {
    x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d,
    y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d,
  };
}

/** `steps` points along the arc from `a` through `apex` towards `b`, `b` left out. */
function arcSamples(a: Vec, apex: Vec, b: Vec, steps: number): Vec[] {
  const c = circleThrough(a, apex, b);
  if (!c) {
    return Array.from({ length: steps }, (_, j) => ({
      x: a.x + ((b.x - a.x) * j) / steps,
      y: a.y + ((b.y - a.y) * j) / steps,
    }));
  }
  const tau = 2 * Math.PI;
  const turn = (v: number) => ((v % tau) + tau) % tau;
  const r = Math.hypot(a.x - c.x, a.y - c.y);
  const start = Math.atan2(a.y - c.y, a.x - c.x);
  const toEnd = turn(Math.atan2(b.y - c.y, b.x - c.x) - start);
  const toApex = turn(Math.atan2(apex.y - c.y, apex.x - c.x) - start);
  // Go whichever way round passes the apex.
  const sweep = toApex < toEnd ? toEnd : toEnd - tau;
  return Array.from({ length: steps }, (_, j) => {
    const t = start + (sweep * j) / steps;
    return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) };
  });
}

/**
 * A cloud in the manner of tldraw's: bumps of a set width (by stroke size)
 * spaced round a pill inset in the box, so a long cloud gets more bumps
 * rather than stretched ones, and each cusp nudged by a per-shape seed.
 *
 * Kept a polygon (arcs sampled densely enough that the round join hides the
 * facets) so the fill, the drawn and dashed outlines and the hit test all
 * take it as they take a hexagon.
 */
function cloud(w: number, h: number, seed: string, size: number): Vec[] {
  const perimeter = pillPerimeter(w, h);
  // ponytail: capped so a 1px-tall sliver doesn't sample thousands of bumps.
  const n = Math.min(
    200,
    Math.max(
      6,
      Math.ceil(perimeter / bumpWidth(size)),
      Math.ceil(perimeter / Math.max(1, Math.min(w, h))),
    ),
  );
  const protrusion = (perimeter / n) * 0.2;
  const iw = Math.max(w - 2 * protrusion, 1);
  const ih = Math.max(h - 2 * protrusion, 1);
  const padX = (w - iw) / 2;
  const padY = (h - ih) / 2;
  const spacing = pillPerimeter(iw, ih) / n;
  const base = pillPoints(iw, ih, n).map((p) => ({ x: p.x + padX, y: p.y + padY }));

  // Wiggle in pairs from both ends, so a bump added on resize appears in
  // the middle and the rest keep their shape.
  const random = rng(seed);
  const wiggleX = w < 20 ? 0 : protrusion * 0.3;
  const wiggleY = h < 20 ? 0 : protrusion * 0.3;
  const cusps = base.slice();
  for (let i = 0; i < Math.floor(n / 2); i++) {
    for (const k of [i, n - 1 - i]) {
      cusps[k] = {
        x: base[k]!.x + random() * wiggleX,
        y: base[k]!.y + random() * wiggleY,
      };
    }
  }

  const pts: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = base[i]!;
    const b = base[j]!;
    const chord = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const wiggled = Math.hypot(cusps[j]!.x - cusps[i]!.x, cusps[j]!.y - cusps[i]!.y);
    // Round the pill's ends the chord cuts the curve short; bulge to make up.
    const bulge = (Math.max(padX, padY) + spacing - chord) * (wiggled / chord);
    // Clockwise, so the outward normal of a->b is (dy, -dx).
    const apex = {
      x: Math.min(w, Math.max(0, (a.x + b.x) / 2 + ((b.y - a.y) / chord) * bulge)),
      y: Math.min(h, Math.max(0, (a.y + b.y) / 2 - ((b.x - a.x) / chord) * bulge)),
    };
    pts.push(...arcSamples(cusps[i]!, apex, cusps[j]!, CLOUD_BUMP_SAMPLES));
  }
  // An arc can lean a hair past its clamped apex; the box is the bounds.
  return pts.map((p) => ({
    x: Math.min(w, Math.max(0, p.x)),
    y: Math.min(h, Math.max(0, p.y)),
  }));
}

const STAR = star();

/** Vertices in the unit box [0,1] x [0,1]; the cloud depends on its size. */
function normalizedPolygonPoints(kind: Exclude<PolygonKind, 'cloud'>): Vec[] {
  switch (kind) {
    case 'triangle':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'diamond':
      return [
        { x: 0.5, y: 0 },
        { x: 1, y: 0.5 },
        { x: 0.5, y: 1 },
        { x: 0, y: 0.5 },
      ];
    case 'parallelogram':
      return [
        { x: 0.25, y: 0 },
        { x: 1, y: 0 },
        { x: 0.75, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'trapezoid':
      return [
        { x: 0.25, y: 0 },
        { x: 0.75, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
    case 'pentagon':
      return regular(5);
    case 'hexagon':
      return regular(6);
    case 'star':
      return STAR;
  }
}

/**
 * Polygon vertices placed in a world-space box. `seed` (the shape id) and
 * `size` (its stroke width) only shape a cloud.
 */
export function polygonVerticesForBox(
  kind: PolygonKind,
  x: number,
  y: number,
  w: number,
  h: number,
  seed = '',
  size = BASE_STROKE_WIDTH,
): Vec[] {
  if (kind === 'cloud') {
    return cloud(w, h, seed, size).map((p) => ({ x: x + p.x, y: y + p.y }));
  }
  return normalizedPolygonPoints(kind).map((p) => ({
    x: x + p.x * w,
    y: y + p.y * h,
  }));
}

/** SVG `points` attribute for a polygon placed in a world-space box. */
export function polygonPointsForBox(
  kind: PolygonKind,
  x: number,
  y: number,
  w: number,
  h: number,
  seed?: string,
  size?: number,
): string {
  return polygonVerticesForBox(kind, x, y, w, h, seed, size)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}
