import type {
  GraphExpression,
  GraphParameter,
  GraphParametricDomain,
  GraphViewport,
} from '@whiteboard/shared';
import { parametricDomain } from './graph-defaults';
import {
  EMPTY_GRAPH_FUNCTIONS,
  isCoordinateExpression,
  parseGraphExpression,
  type GraphFunctionDefinitions,
  type ParsedGraphCoordinate,
  type ParsedGraphExpression,
  type ParsedGraphFunction,
} from './graph-parser';

export interface GraphSampleResult {
  ok: boolean;
  message?: string;
  segments: { x: number; y: number }[][];
  /** Plotted dots — a coordinate expression resolves to one of these. */
  points?: { x: number; y: number }[];
}

type ContourPoint = { x: number; y: number };
type ContourLine = { a: ContourPoint; b: ContourPoint };

/**
 * Marching-squares lookup tables, indexed by the four corner signs of a cell.
 *
 * Corners run counter-clockwise from the bottom-left; edge `n` joins corner `n`
 * to corner `n + 1`. Each entry lists the edges the contour crosses, in pairs.
 * Cases 5 and 10 are the ambiguous saddles, resolved separately by the sign at
 * the cell center. These were array literals built inside the cell loop, which
 * meant two arrays and a closure allocated for each of the ~30k cells in a pass.
 */
const CONTOUR_EDGE_CORNERS = [0, 1, 1, 2, 2, 3, 3, 0] as const;

const CONTOUR_EDGES: readonly (readonly number[])[] = [
  [], // 0: no crossing
  [3, 0],
  [0, 1],
  [3, 1],
  [1, 2],
  [], // 5: saddle
  [0, 2],
  [3, 2],
  [2, 3],
  [0, 2],
  [], // 10: saddle
  [1, 2],
  [3, 1],
  [0, 1],
  [3, 0],
  [], // 15: no crossing
];

const SADDLE_CONNECTED = [0, 1, 2, 3] as const;
const SADDLE_CROSSED = [3, 0, 1, 2] as const;

/** Find an actual zero on an edge; a sign change alone may be a pole. */
function interpolateZero(
  aX: number,
  aY: number,
  bX: number,
  bY: number,
  valueA: number,
  valueB: number,
  evaluate: (x: number, y: number) => number,
): ContourPoint | null {
  if (valueA === 0) return { x: aX, y: aY };
  if (valueB === 0) return { x: bX, y: bY };
  const tolerance = Math.min(Math.abs(valueA), Math.abs(valueB)) * 1e-6;
  let lo = 0;
  let hi = 1;
  let loValue = valueA;
  // Linear relations usually converge on the first probe. Nonlinear ones use
  // bisection, and must reduce the residual relative to both original ends.
  const scale = Math.max(Math.abs(valueA), Math.abs(valueB));
  let t = valueA / scale / (valueA / scale - valueB / scale);
  for (let i = 0; i < 32; i += 1) {
    const point = { x: aX + (bX - aX) * t, y: aY + (bY - aY) * t };
    const value = evaluate(point.x, point.y);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) <= tolerance) return point;
    if (loValue < 0 === value < 0) {
      lo = t;
      loValue = value;
    } else {
      hi = t;
    }
    t = (lo + hi) / 2;
  }
  return null;
}

function stitchContourLines(
  lines: ContourLine[],
  xStep: number,
  yStep: number,
): ContourPoint[][] {
  const xTolerance = Math.max(Math.abs(xStep) * 1e-5, Number.EPSILON);
  const yTolerance = Math.max(Math.abs(yStep) * 1e-5, Number.EPSILON);
  const key = (point: ContourPoint) =>
    `${Math.round(point.x / xTolerance)}:${Math.round(point.y / yTolerance)}`;
  const endpoints = lines.map((line) => ({ a: key(line.a), b: key(line.b) }));
  const adjacency = new Map<string, number[]>();

  const link = (endpointKey: string, index: number) => {
    const existing = adjacency.get(endpointKey);
    if (existing) existing.push(index);
    else adjacency.set(endpointKey, [index]);
  };
  endpoints.forEach((endpoint, index) => {
    link(endpoint.a, index);
    link(endpoint.b, index);
  });

  const used = new Set<number>();
  /** Follow unused lines from `key`, appending each far end to `points`. */
  const walk = (key: string, points: ContourPoint[]) => {
    let currentKey = key;
    while (true) {
      const nextIndex = adjacency
        .get(currentKey)
        ?.find((index) => !used.has(index));
      if (nextIndex === undefined) return;
      used.add(nextIndex);
      const line = lines[nextIndex]!;
      const endpoint = endpoints[nextIndex]!;
      const leavesFromA = endpoint.a === currentKey;
      points.push(leavesFromA ? line.b : line.a);
      currentKey = leavesFromA ? endpoint.b : endpoint.a;
    }
  };

  const paths: ContourPoint[][] = [];
  for (let seed = 0; seed < lines.length; seed += 1) {
    if (used.has(seed)) continue;
    used.add(seed);
    // The seed is usually mid-curve (lines arrive in grid order, not curve
    // order), so grow it both ways. A closed loop is used up by the forward
    // walk, which leaves the backward one nothing to add.
    const forward = [lines[seed]!.a, lines[seed]!.b];
    walk(endpoints[seed]!.b, forward);
    const backward: ContourPoint[] = [];
    walk(endpoints[seed]!.a, backward);
    paths.push([...backward.reverse(), ...forward]);
  }
  return paths;
}

function sampleImplicitGraphExpression(
  parsed: ParsedGraphFunction,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  horizontalSamples: number,
  verticalSamples: number,
): GraphSampleResult {
  const columns = Math.max(
    32,
    Math.min(320, Math.round(horizontalSamples * 0.55)),
  );
  const rows = Math.max(32, Math.min(240, Math.round(verticalSamples * 0.55)));
  const xStep = (viewport.xMax - viewport.xMin) / columns;
  const yStep = (viewport.yMax - viewport.yMin) / rows;
  const stride = columns + 1;
  // One flat Float64Array rather than a row-per-array grid: the contour pass
  // reads it ~120k times and the nested arrays cost a bounds-checked pointer
  // chase (plus `rows` allocations) for every one of them.
  const values = new Float64Array(stride * (rows + 1));
  const evaluate = parsed.createEvaluator(parameters);

  for (let row = 0; row <= rows; row += 1) {
    const y = viewport.yMin + row * yStep;
    const offset = row * stride;
    for (let column = 0; column <= columns; column += 1) {
      values[offset + column] = evaluate(viewport.xMin + column * xStep, y);
    }
  }

  const lines: ContourLine[] = [];
  // Reused across cells; `interpolateZero` reads them and returns fresh points.
  const cornerX = [0, 0, 0, 0];
  const cornerY = [0, 0, 0, 0];
  const cornerValue = [0, 0, 0, 0];

  const edgePoint = (edge: number): ContourPoint | null => {
    const a = CONTOUR_EDGE_CORNERS[edge * 2]!;
    const b = CONTOUR_EDGE_CORNERS[edge * 2 + 1]!;
    return interpolateZero(
      cornerX[a]!,
      cornerY[a]!,
      cornerX[b]!,
      cornerY[b]!,
      cornerValue[a]!,
      cornerValue[b]!,
      evaluate,
    );
  };

  for (let row = 0; row < rows; row += 1) {
    const y0 = viewport.yMin + row * yStep;
    const y1 = y0 + yStep;
    const bottom = row * stride;
    const top = bottom + stride;
    for (let column = 0; column < columns; column += 1) {
      const v0 = values[bottom + column]!;
      const v1 = values[bottom + column + 1]!;
      const v2 = values[top + column + 1]!;
      const v3 = values[top + column]!;
      if (
        !Number.isFinite(v0) ||
        !Number.isFinite(v1) ||
        !Number.isFinite(v2) ||
        !Number.isFinite(v3)
      ) {
        continue;
      }

      const cellCase =
        (v0 >= 0 ? 1 : 0) |
        (v1 >= 0 ? 2 : 0) |
        (v2 >= 0 ? 4 : 0) |
        (v3 >= 0 ? 8 : 0);
      if (cellCase === 0 || cellCase === 15) continue;

      const x0 = viewport.xMin + column * xStep;
      const x1 = x0 + xStep;
      cornerX[0] = x0;
      cornerY[0] = y0;
      cornerX[1] = x1;
      cornerY[1] = y0;
      cornerX[2] = x1;
      cornerY[2] = y1;
      cornerX[3] = x0;
      cornerY[3] = y1;
      cornerValue[0] = v0;
      cornerValue[1] = v1;
      cornerValue[2] = v2;
      cornerValue[3] = v3;

      let edges = CONTOUR_EDGES[cellCase]!;
      if (cellCase === 5 || cellCase === 10) {
        // Saddle: the center sign decides which way the two branches connect.
        const centerPositive = (v0 + v1 + v2 + v3) / 4 >= 0;
        const connected = cellCase === 5 ? centerPositive : !centerPositive;
        edges = connected ? SADDLE_CONNECTED : SADDLE_CROSSED;
      }
      for (let i = 0; i < edges.length; i += 2) {
        const a = edgePoint(edges[i]!);
        const b = edgePoint(edges[i + 1]!);
        if (a && b) lines.push({ a, b });
      }
    }
  }

  return { ok: true, segments: stitchContourLines(lines, xStep, yStep) };
}

/**
 * How far outside the viewport a curve is allowed to run before its
 * coordinates are clamped.
 *
 * Anything beyond this is behind the plot's clip path and cannot be seen, but
 * unclamped it still reaches the SVG as path data — an asymptote approaching a
 * pole produces coordinates in the millions, which costs bytes and precision in
 * every point the browser then has to transform.
 */
const OFFSCREEN_RANGES = 4;

/** Cap on how many times one interval may be halved when refining. */
const MAX_REFINEMENT_DEPTH = 5;

/** Multiple of the viewport height that counts as a suspicious vertical jump. */
const JUMP_RANGES = 1.75;

function clampToRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Halvings before a change that won't shrink counts as a jump. */
const MAX_JUMP_BISECTIONS = 60;

/**
 * The bracket around a jump or pole between two samples, or null when the
 * curve is continuous there.
 *
 * Neither the size of the change nor a midpoint probe tells a jump from a
 * steep stretch: `floor(x)` steps less than a zoomed-in `exp(10x)` climbs. So
 * keep halving toward the half that changes more. On a continuous curve that
 * change shrinks with the interval and soon falls below `flatness`; across a
 * jump it never does, and the bracket closes in on the jump itself — which is
 * where the two pieces should end.
 */
function findJump(
  f: (x: number) => number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  flatness: number,
): { x0: number; y0: number; x1: number; y1: number } | null {
  for (let i = 0; i < MAX_JUMP_BISECTIONS; i += 1) {
    const xMid = (x0 + x1) / 2;
    // Out of float resolution with the change still standing.
    if (xMid <= x0 || xMid >= x1) break;
    const yMid = f(xMid);
    if (!Number.isFinite(yMid)) break;
    if (Math.abs(yMid - y0) >= Math.abs(y1 - yMid)) {
      x1 = xMid;
      y1 = yMid;
    } else {
      x0 = xMid;
      y0 = yMid;
    }
    if (Math.abs(y1 - y0) <= flatness) return null;
  }
  return { x0, y0, x1, y1 };
}

function sampleExplicitGraphExpression(
  parsed: ParsedGraphFunction,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples: number,
): GraphSampleResult {
  const f = parsed.createEvaluator(parameters);
  const xRange = viewport.xMax - viewport.xMin;
  const yRange = viewport.yMax - viewport.yMin;
  // Half a sample step: below this the extra point lands on the same pixel.
  const flatness = Math.abs(yRange) / samples / 2;
  // A change of a couple of pixels or more might be a jump worth breaking at.
  const jumpCheck = flatness * 4;
  const minStep = Math.abs(xRange) / samples / (1 << MAX_REFINEMENT_DEPTH);
  const clampMin = viewport.yMin - Math.abs(yRange) * OFFSCREEN_RANGES;
  const clampMax = viewport.yMax + Math.abs(yRange) * OFFSCREEN_RANGES;

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const push = (x: number, y: number) => {
    current.push({ x, y: clampToRange(y, clampMin, clampMax) });
  };
  const flush = () => {
    if (current.length > 1) segments.push(current);
    current = [];
  };

  /**
   * Insert points between two samples until the curve between them is flat
   * enough to draw as a straight line. Costs one evaluation on smooth stretches
   * (the midpoint test fails immediately) and only pays for depth where the
   * curve actually bends — which is what keeps a zoomed-in peak from reading as
   * a polygon without raising the sample count everywhere.
   */
  const refine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    depth: number,
  ) => {
    if (depth >= MAX_REFINEMENT_DEPTH || x1 - x0 <= minStep) return;
    const xMid = (x0 + x1) / 2;
    const yMid = f(xMid);
    if (!Number.isFinite(yMid)) return;
    if (Math.abs(yMid - (y0 + y1) / 2) <= flatness) return;
    refine(x0, y0, xMid, yMid, depth + 1);
    push(xMid, yMid);
    refine(xMid, yMid, x1, y1, depth + 1);
  };

  let previousX = Number.NaN;
  let previousY = Number.NaN;

  for (let i = 0; i <= samples; i += 1) {
    const x = viewport.xMin + (xRange * i) / samples;
    const y = f(x);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      flush();
      previousY = Number.NaN;
      continue;
    }
    // Both ends off the same edge: the join is out of sight either way.
    const offscreen =
      (y > viewport.yMax && previousY > viewport.yMax) ||
      (y < viewport.yMin && previousY < viewport.yMin);
    const jump =
      Number.isFinite(previousY) &&
      !offscreen &&
      Math.abs(y - previousY) > jumpCheck
        ? findJump(f, previousX, previousY, x, y, flatness)
        : null;
    if (!Number.isFinite(previousY)) {
      push(x, y);
    } else if (jump) {
      if (jump.x0 > previousX) push(jump.x0, jump.y0);
      flush();
      if (jump.x1 < x) push(jump.x1, jump.y1);
      push(x, y);
    } else {
      refine(previousX, previousY, x, y, 0);
      push(x, y);
    }
    previousX = x;
    previousY = y;
  }

  flush();
  return { ok: true, segments };
}

function sampleCoordinateExpression(
  parsed: ParsedGraphCoordinate,
  domain: GraphParametricDomain | undefined,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples: number,
): GraphSampleResult {
  const at = parsed.createEvaluator(parameters);
  if (parsed.kind === 'point') {
    const point = at(0);
    const finite = Number.isFinite(point.x) && Number.isFinite(point.y);
    return { ok: true, segments: [], points: finite ? [point] : [] };
  }

  const { min, max } = parametricDomain(domain);
  const span = max - min;
  const xRange = Math.abs(viewport.xMax - viewport.xMin);
  const yRange = Math.abs(viewport.yMax - viewport.yMin);
  const xJump = xRange * JUMP_RANGES;
  const yJump = yRange * JUMP_RANGES;
  // Refinement matters more here than for explicit curves: a uniform sweep in
  // `t` is not uniform in space, so a curve like `(t^3, t)` bunches its samples
  // at one end and leaves visible corners at the other.
  const flatness = Math.min(xRange, yRange) / samples / 2;
  const minStep = span / samples / (1 << MAX_REFINEMENT_DEPTH);
  const clamp = (point: { x: number; y: number }) => ({
    x: clampToRange(
      point.x,
      viewport.xMin - xRange * OFFSCREEN_RANGES,
      viewport.xMax + xRange * OFFSCREEN_RANGES,
    ),
    y: clampToRange(
      point.y,
      viewport.yMin - yRange * OFFSCREEN_RANGES,
      viewport.yMax + yRange * OFFSCREEN_RANGES,
    ),
  });

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  const flush = () => {
    if (current.length > 1) segments.push(current);
    current = [];
  };

  const refine = (
    t0: number,
    p0: { x: number; y: number },
    t1: number,
    p1: { x: number; y: number },
    depth: number,
  ) => {
    if (depth >= MAX_REFINEMENT_DEPTH || t1 - t0 <= minStep) return;
    const tMid = (t0 + t1) / 2;
    const mid = at(tMid);
    if (!Number.isFinite(mid.x) || !Number.isFinite(mid.y)) return;
    const deviation = Math.hypot(
      mid.x - (p0.x + p1.x) / 2,
      mid.y - (p0.y + p1.y) / 2,
    );
    if (deviation <= flatness) return;
    refine(t0, p0, tMid, mid, depth + 1);
    current.push(clamp(mid));
    refine(tMid, mid, t1, p1, depth + 1);
  };

  let previousT = min;
  let previous: { x: number; y: number } | null = null;

  for (let i = 0; i <= samples; i += 1) {
    const t = min + (span * i) / samples;
    const point = at(t);
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      flush();
      previous = null;
      previousT = t;
      continue;
    }
    if (
      previous &&
      (Math.abs(point.x - previous.x) > xJump ||
        Math.abs(point.y - previous.y) > yJump)
    ) {
      flush();
    } else if (previous) {
      refine(previousT, previous, t, point, 0);
    }
    current.push(clamp(point));
    previous = point;
    previousT = t;
  }

  flush();
  return { ok: true, segments };
}

export interface GraphSampleOptions {
  viewport: GraphViewport;
  parameters: Record<string, GraphParameter>;
  /** Horizontal sample budget, normally about one per plot pixel. */
  samples: number;
  /** Vertical budget for the contour grid. Defaults to `samples`. */
  verticalSamples?: number;
  /** `t` range for parametric expressions. */
  domain?: GraphParametricDomain;
}

const MIN_SAMPLES = 24;
const MAX_SAMPLES = 1600;

/**
 * Turn an already-parsed expression into drawable segments.
 *
 * Kept separate from parsing so a caller that samples the same expression
 * repeatedly — every render, every slider frame — parses once and pays only for
 * the sampling.
 */
export function sampleParsedGraphExpression(
  parsed: ParsedGraphExpression,
  options: GraphSampleOptions,
): GraphSampleResult {
  const { viewport, parameters } = options;
  const count = clampToRange(
    Math.round(options.samples),
    MIN_SAMPLES,
    MAX_SAMPLES,
  );

  if (isCoordinateExpression(parsed)) {
    return sampleCoordinateExpression(
      parsed,
      options.domain,
      viewport,
      parameters,
      count,
    );
  }
  if (parsed.kind === 'implicit') {
    return sampleImplicitGraphExpression(
      parsed,
      viewport,
      parameters,
      count,
      clampToRange(
        Math.round(options.verticalSamples ?? options.samples),
        MIN_SAMPLES,
        MAX_SAMPLES,
      ),
    );
  }
  return sampleExplicitGraphExpression(parsed, viewport, parameters, count);
}

/** Parse (cached) and sample one expression from a graph shape. */
export function sampleGraphExpression(
  expression: GraphExpression,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples: number,
  verticalSamples = samples,
  definitions: GraphFunctionDefinitions = EMPTY_GRAPH_FUNCTIONS,
): GraphSampleResult {
  if (!expression.visible) return { ok: true, segments: [] };
  const parsed = parseGraphExpression(expression.expression, definitions);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, segments: [] };
  }
  return sampleParsedGraphExpression(parsed, {
    viewport,
    parameters,
    samples,
    verticalSamples,
    domain: expression.domain,
  });
}
