import type {
  GraphExpression,
  GraphParameter,
  GraphViewport,
} from '@whiteboard/shared';
import {
  createGraphFunctionDefinitions,
  parseGraphExpression,
  type GraphFunctionDefinitions,
} from './graph-parser';
import {
  sampleParsedGraphExpression,
  type GraphSampleResult,
} from './graph-sampler';

export type IntersectionKind = 'curve-curve' | 'x-axis' | 'y-axis';

export interface IntersectionPoint {
  x: number;
  y: number;
  kind: IntersectionKind;
}

export const MAX_INTERSECTIONS = 40;

const BISECTION_ITERATIONS = 40;

/**
 * Minimise `sign * f` over [lo, hi] by golden section. At a sampled dip this
 * lands on a tangency (value 0) or, when the curve dips through zero and back
 * between two samples, on a point of the opposite sign.
 */
function dipMinimum(
  f: (x: number) => number,
  lo: number,
  hi: number,
  sign: number,
): number | null {
  const g = (x: number) => sign * f(x);
  const ratio = (Math.sqrt(5) - 1) / 2;
  let a = hi - ratio * (hi - lo);
  let b = lo + ratio * (hi - lo);
  let fa = g(a);
  let fb = g(b);
  for (let i = 0; i < 60; i += 1) {
    if (!Number.isFinite(fa) || !Number.isFinite(fb)) return null;
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - ratio * (hi - lo);
      fa = g(a);
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + ratio * (hi - lo);
      fb = g(b);
    }
  }
  return fa < fb ? a : b;
}

/** Bisect a sign change of `f` on [lo, hi]; null when |f| doesn't vanish there (a pole). */
function bisectRoot(
  f: (x: number) => number,
  lo: number,
  loY: number,
  hi: number,
  tolerance: number,
): number | null {
  for (let iter = 0; iter < BISECTION_ITERATIONS; iter += 1) {
    const mid = (lo + hi) / 2;
    const midY = f(mid);
    if (!Number.isFinite(midY)) break;
    if (loY * midY <= 0) hi = mid;
    else {
      lo = mid;
      loY = midY;
    }
  }
  const root = (lo + hi) / 2;
  const value = f(root);
  return Number.isFinite(value) && Math.abs(value) <= tolerance ? root : null;
}

/**
 * Roots of `f` over [xMin, xMax]: uniform scan for sign changes, refined by
 * bisection, plus sampled dips toward zero, which are either tangencies or two
 * crossings closer together than one sample step.
 * A sign change across a pole (e.g. tan at pi/2) also brackets, so
 * candidates are only accepted when |f| actually vanishes at the limit.
 * `ys` holds f already sampled on the scan grid (see `sampleCurve`); only the
 * refinement calls `f` itself.
 */
function findRoots(
  f: (x: number) => number,
  ys: Float64Array,
  viewport: GraphViewport,
  samples: number,
): number[] {
  const step = (viewport.xMax - viewport.xMin) / samples;
  const tolerance = Math.max(1e-9, (viewport.yMax - viewport.yMin) * 1e-6);
  const roots: number[] = [];
  const push = (root: number | null) => {
    if (root !== null) roots.push(root);
  };
  let prevX = viewport.xMin;
  let prevY = ys[0]!;
  let beforeX = prevX;
  let beforeY = Number.NaN;
  for (let i = 1; i <= samples; i += 1) {
    const x = viewport.xMin + i * step;
    const y = ys[i]!;
    if (
      Number.isFinite(beforeY) &&
      Number.isFinite(prevY) &&
      Number.isFinite(y) &&
      Math.sign(beforeY) === Math.sign(prevY) &&
      Math.sign(prevY) === Math.sign(y) &&
      Math.abs(prevY) < Math.abs(beforeY) &&
      Math.abs(prevY) <= Math.abs(y)
    ) {
      const sign = Math.sign(prevY);
      const at = dipMinimum(f, beforeX, x, sign);
      const value = at === null ? Number.NaN : f(at);
      if (sign * value < 0) {
        push(bisectRoot(f, beforeX, beforeY, at!, tolerance));
        push(bisectRoot(f, at!, value, x, tolerance));
      } else if (
        // A near miss must not count as a root just because the viewport is
        // tall. Require convergence relative to the neighbouring samples too.
        Math.abs(value) <=
        Math.min(tolerance, Math.max(Math.abs(beforeY), Math.abs(y)) * 1e-10)
      ) {
        roots.push(at!);
      }
    }
    // Both ends exactly zero is a curve lying on the other (y = 0 against the
    // x-axis): every step would count, flooding the cap.
    if (
      Number.isFinite(prevY) &&
      Number.isFinite(y) &&
      prevY * y <= 0 &&
      (prevY !== 0 || y !== 0)
    ) {
      push(bisectRoot(f, prevX, prevY, x, tolerance));
    }
    beforeX = prevX;
    beforeY = prevY;
    prevX = x;
    prevY = y;
  }
  return roots;
}

/** f on the scan grid `findRoots` walks, xMin..xMax inclusive. */
function sampleCurve(
  f: (x: number) => number,
  viewport: GraphViewport,
  samples: number,
): Float64Array {
  const step = (viewport.xMax - viewport.xMin) / samples;
  const ys = new Float64Array(samples + 1);
  for (let i = 0; i <= samples; i += 1) ys[i] = f(viewport.xMin + i * step);
  return ys;
}

/** Zero exactly on a curve or axis: `y - f(x)` for an explicit curve. */
type Residual = (x: number, y: number) => number;

/**
 * Newton on F = G = 0 from a point already near both, with a numeric Jacobian.
 * Null unless it converges close to where it started — a jump to another
 * crossing, or a sign change across a pole, isn't this crossing.
 */
function polishCrossing(
  F: Residual,
  G: Residual,
  x0: number,
  y0: number,
  viewport: GraphViewport,
  reach: number,
): { x: number; y: number } | null {
  const span = Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin);
  const h = span * 1e-7;
  let x = x0;
  let y = y0;
  for (let i = 0; i < 12; i += 1) {
    const f = F(x, y);
    const g = G(x, y);
    const fx = (F(x + h, y) - F(x - h, y)) / (2 * h);
    const fy = (F(x, y + h) - F(x, y - h)) / (2 * h);
    const gx = (G(x + h, y) - G(x - h, y)) / (2 * h);
    const gy = (G(x, y + h) - G(x, y - h)) / (2 * h);
    const det = fx * gy - fy * gx;
    if (!Number.isFinite(det) || det === 0) return null;
    const dx = (f * gy - fy * g) / det;
    const dy = (fx * g - f * gx) / det;
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
    x -= dx;
    y -= dy;
    if (Math.abs(dx) + Math.abs(dy) < span * 1e-12) break;
  }
  const converged =
    Math.abs(F(x, y)) <= span * 1e-6 && Math.abs(G(x, y)) <= span * 1e-6;
  return converged && Math.hypot(x - x0, y - y0) <= reach ? { x, y } : null;
}

/**
 * Where `other` changes sign along the sampled contour of the implicit curve
 * `F`, polished onto both. Covers an implicit curve against anything with a
 * residual: explicit and implicit curves alike, and the axes.
 * ponytail: a tangency never changes sign along the contour, so a line touching
 * a circle is missed; seed Newton from residual minima if that matters.
 */
function contourCrossings(
  F: Residual,
  segments: readonly { x: number; y: number }[][],
  other: Residual,
  viewport: GraphViewport,
  reach: number,
): { x: number; y: number }[] {
  const found: { x: number; y: number }[] = [];
  for (const line of segments) {
    let p = line[0];
    let rp = p ? other(p.x, p.y) : Number.NaN;
    for (let i = 1; i < line.length; i += 1) {
      const q = line[i]!;
      const rq = other(q.x, q.y);
      if (Number.isFinite(rp) && Number.isFinite(rq) && rp * rq <= 0 && (rp !== 0 || rq !== 0)) {
        const t = rp === rq ? 0 : rp / (rp - rq);
        const point = polishCrossing(
          F,
          other,
          p!.x + t * (q.x - p!.x),
          p!.y + t * (q.y - p!.y),
          viewport,
          reach,
        );
        if (point) found.push(point);
      }
      p = q;
      rp = rq;
    }
  }
  return found;
}

const KIND_PRIORITY: Record<IntersectionKind, number> = {
  'curve-curve': 0,
  'x-axis': 1,
  'y-axis': 2,
};

const X_AXIS: Residual = (_x, y) => y;
const Y_AXIS: Residual = (x) => x;

/**
 * Intersections among the visible curves and between each curve and the x/y
 * axes, within the viewport. Explicit pairs are root-found in x; anything with
 * an implicit relation walks that relation's sampled contour (`boundaries`,
 * aligned with `expressions`, else sampled here). Results are deduped at
 * sampling resolution and capped at MAX_INTERSECTIONS.
 */
export function findGraphIntersections(
  expressions: GraphExpression[],
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples = 240,
  definitions: GraphFunctionDefinitions = createGraphFunctionDefinitions(
    expressions,
  ),
  boundaries?: readonly GraphSampleResult[],
): IntersectionPoint[] {
  const curves: ((x: number) => number)[] = [];
  const implicits: { F: Residual; segments: { x: number; y: number }[][] }[] = [];
  expressions.forEach((expression, index) => {
    if (!expression.visible) return;
    const parsed = parseGraphExpression(expression.expression, definitions);
    if (!parsed.ok) return;
    // Root finding evaluates each curve thousands of times, so bind the
    // sliders once rather than rebuilding the scope on every probe.
    if (parsed.kind === 'explicit') {
      curves.push(parsed.createEvaluator(parameters));
    } else if (parsed.kind === 'implicit') {
      const boundary =
        boundaries?.[index] ??
        sampleParsedGraphExpression(parsed, { viewport, parameters, samples });
      implicits.push({
        F: parsed.createEvaluator(parameters),
        segments: boundary.segments,
      });
    }
  });

  // Each curve is sampled once and every pair scans the difference of the
  // cached samples; sampling f − g afresh per pair cost C² curve passes.
  const sampled = curves.map((f) => sampleCurve(f, viewport, samples));
  const diff = new Float64Array(samples + 1);
  const candidates: IntersectionPoint[] = [];
  for (let i = 0; i < curves.length; i += 1) {
    const f = curves[i]!;
    const fs = sampled[i]!;
    for (let j = i + 1; j < curves.length; j += 1) {
      const g = curves[j]!;
      const gs = sampled[j]!;
      for (let k = 0; k <= samples; k += 1) diff[k] = fs[k]! - gs[k]!;
      for (const root of findRoots((x) => f(x) - g(x), diff, viewport, samples)) {
        const y = f(root);
        if (Number.isFinite(y)) {
          candidates.push({ x: root, y, kind: 'curve-curve' });
        }
      }
    }
    if (viewport.yMin <= 0 && 0 <= viewport.yMax) {
      for (const root of findRoots(f, fs, viewport, samples)) {
        candidates.push({ x: root, y: 0, kind: 'x-axis' });
      }
    }
    if (viewport.xMin <= 0 && 0 <= viewport.xMax) {
      const y = f(0);
      if (Number.isFinite(y)) {
        candidates.push({ x: 0, y, kind: 'y-axis' });
      }
    }
  }

  const reach =
    (2 * Math.max(viewport.xMax - viewport.xMin, viewport.yMax - viewport.yMin)) /
    samples;
  const others: { residual: Residual; kind: IntersectionKind }[] = [
    ...implicits.map(({ F }) => ({ residual: F, kind: 'curve-curve' as const })),
    ...curves.map((f) => ({
      residual: ((x: number, y: number) => y - f(x)) as Residual,
      kind: 'curve-curve' as const,
    })),
    { residual: X_AXIS, kind: 'x-axis' },
    { residual: Y_AXIS, kind: 'y-axis' },
  ];
  implicits.forEach(({ F, segments }, i) => {
    // Other implicits only after this one, so each pair is walked once.
    others.forEach(({ residual, kind }, j) => {
      if (j <= i) return;
      for (const point of contourCrossings(F, segments, residual, viewport, reach)) {
        if (
          point.x < viewport.xMin ||
          point.x > viewport.xMax ||
          point.y < viewport.yMin ||
          point.y > viewport.yMax
        ) {
          continue;
        }
        if (kind === 'x-axis') point.y = 0;
        if (kind === 'y-axis') point.x = 0;
        candidates.push({ ...point, kind });
      }
    });
  });

  candidates.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const epsX = (viewport.xMax - viewport.xMin) / samples;
  const epsY = (viewport.yMax - viewport.yMin) / samples;
  // Snap numeric noise from bisection (e.g. -4e-14) to a clean zero so
  // labels read "(0, 2)" rather than "(-4e-14, 2)".
  for (const point of candidates) {
    if (Math.abs(point.x) < epsX * 1e-3) point.x = 0;
    if (Math.abs(point.y) < epsY * 1e-3) point.y = 0;
  }
  // Compare against what is kept rather than rounding to grid cells: two copies
  // of one root found by different scans can straddle a cell edge. Copies agree
  // far below a sample step, while two real crossings can sit inside one.
  const result: IntersectionPoint[] = [];
  for (const point of candidates) {
    if (
      result.some(
        (kept) =>
          Math.abs(kept.x - point.x) < epsX * 1e-3 &&
          Math.abs(kept.y - point.y) < epsY * 1e-3,
      )
    ) {
      continue;
    }
    result.push(point);
    if (result.length >= MAX_INTERSECTIONS) break;
  }
  return result;
}

/**
 * Format an intersection coordinate with at most two decimal places.
 * Trailing zeros are omitted (e.g. 2 -> "2", 2.5 -> "2.5", 2.567 -> "2.57").
 */
export function formatIntersectionCoordinate(value: number): string {
  if (!Number.isFinite(value)) return '';
  const rounded = Number(value.toFixed(2));
  if (Object.is(rounded, -0) || rounded === 0) return '0';
  return rounded.toString();
}

/** Format an intersection point into a label, e.g. `(1.25, 0)` */
export function formatIntersectionLabel(point: {
  x: number;
  y: number;
}): string {
  return `(${formatIntersectionCoordinate(point.x)}, ${formatIntersectionCoordinate(point.y)})`;
}
