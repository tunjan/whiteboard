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

export type IntersectionKind = 'curve-curve' | 'x-axis' | 'y-axis';

export interface IntersectionPoint {
  x: number;
  y: number;
  kind: IntersectionKind;
}

export const MAX_INTERSECTIONS = 40;

const BISECTION_ITERATIONS = 40;

/**
 * Roots of `f` over [xMin, xMax]: uniform scan for sign changes, refined by
 * bisection. A sign change across a pole (e.g. tan at pi/2) also brackets, so
 * candidates are only accepted when |f| actually vanishes at the limit.
 */
function findRoots(
  f: (x: number) => number,
  viewport: GraphViewport,
  samples: number,
): number[] {
  const step = (viewport.xMax - viewport.xMin) / samples;
  const tolerance = Math.max(1e-9, (viewport.yMax - viewport.yMin) * 1e-6);
  const roots: number[] = [];
  let prevX = viewport.xMin;
  let prevY = f(prevX);
  for (let i = 1; i <= samples; i += 1) {
    const x = viewport.xMin + i * step;
    const y = f(x);
    if (Number.isFinite(prevY) && Number.isFinite(y) && prevY * y <= 0) {
      let lo = prevX;
      let hi = x;
      let loY = prevY;
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
      if (Number.isFinite(value) && Math.abs(value) <= tolerance) {
        roots.push(root);
      }
    }
    prevX = x;
    prevY = y;
  }
  return roots;
}

const KIND_PRIORITY: Record<IntersectionKind, number> = {
  'curve-curve': 0,
  'x-axis': 1,
  'y-axis': 2,
};

/**
 * Intersections among the visible explicit curves and between each curve and
 * the x/y axes, within the viewport. Implicit relations are skipped. Results
 * are deduped on a sampling-resolution grid and capped at MAX_INTERSECTIONS.
 */
export function findGraphIntersections(
  expressions: GraphExpression[],
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples = 240,
  definitions: GraphFunctionDefinitions = createGraphFunctionDefinitions(
    expressions,
  ),
): IntersectionPoint[] {
  const curves: ((x: number) => number)[] = [];
  for (const expression of expressions) {
    if (!expression.visible) continue;
    const parsed = parseGraphExpression(expression.expression, definitions);
    if (!parsed.ok || parsed.kind !== 'explicit') continue;
    // Root finding evaluates each curve thousands of times, so bind the
    // sliders once rather than rebuilding the scope on every probe.
    curves.push(parsed.createEvaluator(parameters));
  }

  const candidates: IntersectionPoint[] = [];
  for (let i = 0; i < curves.length; i += 1) {
    const f = curves[i]!;
    for (let j = i + 1; j < curves.length; j += 1) {
      const g = curves[j]!;
      for (const root of findRoots((x) => f(x) - g(x), viewport, samples)) {
        const y = f(root);
        if (Number.isFinite(y)) {
          candidates.push({ x: root, y, kind: 'curve-curve' });
        }
      }
    }
    if (viewport.yMin <= 0 && 0 <= viewport.yMax) {
      for (const root of findRoots(f, viewport, samples)) {
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

  candidates.sort((a, b) => KIND_PRIORITY[a.kind] - KIND_PRIORITY[b.kind]);
  const epsX = (viewport.xMax - viewport.xMin) / samples;
  const epsY = (viewport.yMax - viewport.yMin) / samples;
  // Snap numeric noise from bisection (e.g. -4e-14) to a clean zero so
  // labels read "(0, 2)" rather than "(-4e-14, 2)".
  for (const point of candidates) {
    if (Math.abs(point.x) < epsX * 1e-3) point.x = 0;
    if (Math.abs(point.y) < epsY * 1e-3) point.y = 0;
  }
  const seen = new Set<string>();
  const result: IntersectionPoint[] = [];
  for (const point of candidates) {
    const key = `${Math.round(point.x / epsX)}:${Math.round(point.y / epsY)}`;
    if (seen.has(key)) continue;
    seen.add(key);
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
export function formatIntersectionLabel(point: { x: number; y: number }): string {
  return `(${formatIntersectionCoordinate(point.x)}, ${formatIntersectionCoordinate(point.y)})`;
}
