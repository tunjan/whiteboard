import type {
  GraphExpression,
  GraphParameter,
  GraphParametricDomain,
  GraphViewport,
} from '@whiteboard/shared';
import { parametricDomain } from './graph-defaults';
import {
  LINEAR_AXES,
  toPlotViewport,
  warpParsed,
  type GraphAxes,
} from './graph-scale';
import {
  EMPTY_GRAPH_FUNCTIONS,
  isCoordinateExpression,
  parseGraphExpression,
  satisfies,
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
  /** An inequality's region: rectangles `x0, y0, x1, y1, …` in graph units. */
  fill?: number[];
  /** A strict inequality, whose boundary isn't part of its region. */
  strict?: boolean;
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
  // False position with the Illinois tweak: halve the end that keeps getting
  // chosen, so a curving relation still converges in a handful of steps where
  // plain bisection took 20–30. Linear ones land on the first probe. Values
  // are scaled to keep huge ones from overflowing the interpolation.
  const scale = Math.max(Math.abs(valueA), Math.abs(valueB));
  let lo = 0;
  let hi = 1;
  let loValue = valueA / scale;
  let hiValue = valueB / scale;
  let kept = 0;
  for (let i = 0; i < 40; i += 1) {
    const t = (lo * hiValue - hi * loValue) / (hiValue - loValue);
    const point = { x: aX + (bX - aX) * t, y: aY + (bY - aY) * t };
    const value = evaluate(point.x, point.y);
    if (!Number.isFinite(value)) return null;
    if (Math.abs(value) <= tolerance) return point;
    if (loValue < 0 === value < 0) {
      lo = t;
      loValue = value / scale;
      if (kept === 1) hiValue /= 2;
      kept = 1;
    } else {
      hi = t;
      hiValue = value / scale;
      if (kept === -1) loValue /= 2;
      kept = -1;
    }
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

/** Finest-grid cells per side of the blocks the contour pass starts from. */
const CONTOUR_BLOCK = 8;

/**
 * Whether a block whose grid points read these values could hold part
 * of the curve. A sign change (or a value it can't read) certainly might.
 * Otherwise a zero inside would have to lie closer than the block's own spread
 * of values suggests the function travels — far from zero relative to that
 * spread, the block is skipped whole.
 */
function blockMightCross(values: readonly number[]): boolean {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) return true;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (min <= 0 && max >= 0) return true;
  return Math.min(Math.abs(min), Math.abs(max)) <= max - min;
}

/**
 * How far a parabola's vertex may stay from zero, relative to the sample, to
 * be worth a search. An ordinary minimum sits near 1; a touch is 0 for an
 * exact square, but `(x^2 + y^2 - 4)^2` is quartic along a grid line and its
 * fit lands around 0.3.
 */
const TOUCH_VERTEX_RATIO = 0.5;

/**
 * Where f touches zero without changing sign between the grid points either
 * side of `v` (at s = -1 and 1), or null. These are the curves marching
 * squares cannot see — `(x - y)^2 = 0` never goes negative.
 */
function touchBetween(
  a: number,
  v: number,
  b: number,
  line: (s: number) => number,
): number | null {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  // A sign change is the contour's to draw.
  if (a < 0 !== v < 0 || b < 0 !== v < 0) return null;
  // `<` on one side only, so a flat minimum is claimed by one grid point.
  if (!(Math.abs(v) <= Math.abs(a) && Math.abs(v) < Math.abs(b))) return null;
  // Only a likely touch is worth the search below: a parabola through the
  // three points whose vertex reaches (or passes) zero, where an ordinary
  // minimum keeps it near v — or, when the zero sits almost on this grid point
  // and the fit can't move, a value far below both neighbours'.
  const curvature = (a + b) / 2 - v;
  const slope = (b - a) / 2;
  if (curvature === 0) return null;
  const vertex = v - (slope * slope) / (4 * curvature);
  const deep = Math.abs(v) <= 0.25 * Math.min(Math.abs(a), Math.abs(b));
  if (vertex / v > TOUCH_VERTEX_RATIO && !deep) return null;

  // Golden-section search for the minimum of |f| along the line.
  const ratio = (Math.sqrt(5) - 1) / 2;
  let lo = -1;
  let hi = 1;
  let p = hi - ratio * (hi - lo);
  let q = lo + ratio * (hi - lo);
  let fp = Math.abs(line(p));
  let fq = Math.abs(line(q));
  for (let i = 0; i < 50; i += 1) {
    if (!Number.isFinite(fp) || !Number.isFinite(fq)) return null;
    if (fp < fq) {
      hi = q;
      q = p;
      fq = fp;
      p = hi - ratio * (hi - lo);
      fp = Math.abs(line(p));
    } else {
      lo = p;
      p = q;
      fp = fq;
      q = lo + ratio * (hi - lo);
      fq = Math.abs(line(q));
    }
  }
  const s = fp < fq ? p : q;
  return Math.min(fp, fq) <= Math.max(Math.abs(a), Math.abs(b)) * 1e-6 ? s : null;
}

/**
 * Join scattered points along a curve into paths, nearest neighbour first,
 * growing each path both ways from where it starts. Distances are in grid
 * cells, and a gap over 1.6 of them starts a new path.
 */
function chainPoints(
  points: readonly ContourPoint[],
  xStep: number,
  yStep: number,
): ContourPoint[][] {
  const buckets = new Map<string, number[]>();
  const cellOf = (point: ContourPoint) => [
    Math.floor(point.x / xStep),
    Math.floor(point.y / yStep),
  ];
  points.forEach((point, index) => {
    const key = cellOf(point).join(':');
    const bucket = buckets.get(key);
    if (bucket) bucket.push(index);
    else buckets.set(key, [index]);
  });

  const used = new Uint8Array(points.length);
  const nearest = (from: ContourPoint): number => {
    const [cx, cy] = cellOf(from) as [number, number];
    let best = -1;
    let bestDistance = 1.6 * 1.6;
    for (let dx = -2; dx <= 2; dx += 1) {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (const index of buckets.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (used[index]) continue;
          const point = points[index]!;
          const distance =
            ((point.x - from.x) / xStep) ** 2 + ((point.y - from.y) / yStep) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      }
    }
    return best;
  };
  const grow = (from: ContourPoint, path: ContourPoint[]) => {
    for (let next = nearest(from); next >= 0; next = nearest(from)) {
      used[next] = 1;
      from = points[next]!;
      path.push(from);
    }
  };

  const paths: ContourPoint[][] = [];
  points.forEach((point, index) => {
    if (used[index]) return;
    used[index] = 1;
    const forward = [point];
    grow(point, forward);
    const backward: ContourPoint[] = [];
    grow(point, backward);
    // A lone point is a curve that only touches zero at one place; skip it.
    if (forward.length + backward.length > 1) {
      const path = [...backward.reverse(), ...forward];
      // A loop's two ends meet again: close it.
      const first = path[0]!;
      const last = path[path.length - 1]!;
      const gap = ((last.x - first.x) / xStep) ** 2 + ((last.y - first.y) / yStep) ** 2;
      if (path.length > 2 && gap < 1.6 * 1.6) path.push(first);
      paths.push(path);
    }
  });
  return paths;
}

/**
 * Marching squares over a grid that is only filled in where the curve may be.
 *
 * The plot is cut into blocks of {@link CONTOUR_BLOCK} cells; a block that
 * {@link blockMightCross} clears is skipped, the rest are quartered down to
 * single cells. Most of a typical plot is far from its curve, so this reads a
 * fraction of the grid a full pass would — and what it does read is cached,
 * since neighbouring blocks and cells share corners.
 */
function sampleImplicitGraphExpression(
  parsed: ParsedGraphFunction,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  horizontalSamples: number,
  verticalSamples: number,
): GraphSampleResult {
  const columns = Math.max(
    32,
    Math.min(1024, Math.round(horizontalSamples * 0.55)),
  );
  const rows = Math.max(32, Math.min(768, Math.round(verticalSamples * 0.55)));
  const xStep = (viewport.xMax - viewport.xMin) / columns;
  const yStep = (viewport.yMax - viewport.yMin) / rows;
  const xAt = (column: number) => viewport.xMin + column * xStep;
  const yAt = (row: number) => viewport.yMin + row * yStep;
  const stride = columns + 1;
  // One flat Float64Array rather than a row-per-array grid: the contour pass
  // reads it ~120k times and the nested arrays cost a bounds-checked pointer
  // chase (plus `rows` allocations) for every one of them.
  const values = new Float64Array(stride * (rows + 1));
  const known = new Uint8Array(values.length);
  const evaluate = parsed.createEvaluator(parameters);
  const at = (column: number, row: number): number => {
    const index = row * stride + column;
    if (!known[index]) {
      known[index] = 1;
      values[index] = evaluate(xAt(column), yAt(row));
    }
    return values[index]!;
  };

  const lines: ContourLine[] = [];
  const touches: ContourPoint[] = [];
  // Reused across cells; `interpolateZero` reads them and returns fresh points.
  const cornerX = [0, 0, 0, 0];
  const cornerY = [0, 0, 0, 0];
  const cornerValue = [0, 0, 0, 0];

  // Each edge is shared by two cells; solve it once. Keyed by its first grid
  // point, doubled, plus one for the vertical edge from it.
  const edgePoints = new Map<number, ContourPoint | null>();
  let cellColumn = 0;
  let cellRow = 0;
  const edgePoint = (edge: number): ContourPoint | null => {
    const key =
      ((cellRow + (edge === 2 ? 1 : 0)) * stride + cellColumn + (edge === 1 ? 1 : 0)) * 2 +
      (edge % 2);
    const known = edgePoints.get(key);
    if (known !== undefined) return known;
    const a = CONTOUR_EDGE_CORNERS[edge * 2]!;
    const b = CONTOUR_EDGE_CORNERS[edge * 2 + 1]!;
    const point = interpolateZero(
      cornerX[a]!,
      cornerY[a]!,
      cornerX[b]!,
      cornerY[b]!,
      cornerValue[a]!,
      cornerValue[b]!,
      evaluate,
    );
    edgePoints.set(key, point);
    return point;
  };

  /** A double root through the cell's bottom-left grid point, along x and y. */
  const findTouches = (column: number, row: number) => {
    const v = at(column, row);
    const x = xAt(column);
    const y = yAt(row);
    if (v === 0) {
      touches.push({ x, y });
      return;
    }
    if (column > 0) {
      const s = touchBetween(at(column - 1, row), v, at(column + 1, row), (s) =>
        evaluate(x + s * xStep, y),
      );
      if (s !== null) touches.push({ x: x + s * xStep, y });
    }
    if (row > 0) {
      const s = touchBetween(at(column, row - 1), v, at(column, row + 1), (s) =>
        evaluate(x, y + s * yStep),
      );
      if (s !== null) touches.push({ x, y: y + s * yStep });
    }
  };

  const cell = (column: number, row: number) => {
    const v0 = at(column, row);
    const v1 = at(column + 1, row);
    const v2 = at(column + 1, row + 1);
    const v3 = at(column, row + 1);
    if (
      !Number.isFinite(v0) ||
      !Number.isFinite(v1) ||
      !Number.isFinite(v2) ||
      !Number.isFinite(v3)
    ) {
      return;
    }

    const cellCase =
      (v0 >= 0 ? 1 : 0) |
      (v1 >= 0 ? 2 : 0) |
      (v2 >= 0 ? 4 : 0) |
      (v3 >= 0 ? 8 : 0);
    if (cellCase === 0 || cellCase === 15) {
      findTouches(column, row);
      return;
    }

    // From the column and row indices on both sides, so a neighbour's shared
    // edge lands on the same coordinates bit for bit.
    const x0 = xAt(column);
    const x1 = xAt(column + 1);
    const y0 = yAt(row);
    const y1 = yAt(row + 1);
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

    cellColumn = column;
    cellRow = row;
    let edges = CONTOUR_EDGES[cellCase]!;
    if (cellCase === 5 || cellCase === 10) {
      // Saddle: the sign at the center decides which way the two branches
      // connect. Read it rather than averaging the corners, which guesses
      // wrong whenever the function bends inside the cell.
      const center = evaluate((x0 + x1) / 2, (y0 + y1) / 2);
      const centerPositive =
        (Number.isFinite(center) ? center : (v0 + v1 + v2 + v3) / 4) >= 0;
      const connected = cellCase === 5 ? centerPositive : !centerPositive;
      edges = connected ? SADDLE_CONNECTED : SADDLE_CROSSED;
    }
    for (let i = 0; i < edges.length; i += 2) {
      const a = edgePoint(edges[i]!);
      const b = edgePoint(edges[i + 1]!);
      if (a && b) lines.push({ a, b });
    }
  };

  const visit = (column: number, row: number, size: number) => {
    if (column >= columns || row >= rows) return;
    if (size === 1) {
      cell(column, row);
      return;
    }
    const half = size / 2;
    const right = Math.min(column + size, columns);
    const top = Math.min(row + size, rows);
    const middle = Math.min(column + half, columns);
    const centre = Math.min(row + half, rows);
    // Corners, edge midpoints and centre: the quarters' corners, so a block
    // that does split has already read what its children start from.
    const mightCross = blockMightCross([
      at(column, row),
      at(middle, row),
      at(right, row),
      at(column, centre),
      at(middle, centre),
      at(right, centre),
      at(column, top),
      at(middle, top),
      at(right, top),
    ]);
    if (!mightCross) return;
    visit(column, row, half);
    visit(column + half, row, half);
    visit(column, row + half, half);
    visit(column + half, row + half, half);
  };

  for (let row = 0; row < rows; row += CONTOUR_BLOCK) {
    for (let column = 0; column < columns; column += CONTOUR_BLOCK) {
      visit(column, row, CONTOUR_BLOCK);
    }
  }

  return {
    ok: true,
    segments: [
      ...stitchContourLines(lines, xStep, yStep),
      ...chainPoints(touches, xStep, yStep),
    ],
  };
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

  /**
   * The last point before f stops being defined, between a sample where it is
   * and one where it isn't. Without it `sqrt(1 - x^2)` stops short of the axis
   * and a restricted curve short of its restriction, by up to a sample.
   */
  const domainEdge = (definedX: number, undefinedX: number) => {
    let a = definedX;
    let b = undefinedX;
    let edge: { x: number; y: number } | null = null;
    for (let i = 0; i < 40; i += 1) {
      const mid = (a + b) / 2;
      if (mid === a || mid === b) break;
      const value = f(mid);
      if (Number.isFinite(value)) {
        a = mid;
        edge = { x: mid, y: value };
      } else {
        b = mid;
      }
    }
    return edge;
  };

  let previousX = Number.NaN;
  let previousY = Number.NaN;

  for (let i = 0; i <= samples; i += 1) {
    const x = viewport.xMin + (xRange * i) / samples;
    const y = f(x);

    if (!Number.isFinite(y)) {
      if (Number.isFinite(previousY)) {
        const edge = domainEdge(previousX, x);
        if (edge) {
          refine(previousX, previousY, edge.x, edge.y, 0);
          push(edge.x, edge.y);
        }
      }
      flush();
      previousX = x;
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
      const edge = i > 0 ? domainEdge(x, previousX) : null;
      if (edge) {
        push(edge.x, edge.y);
        refine(edge.x, edge.y, x, y, 0);
      }
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

/** Bisection steps placing a region's edge within a band: 1/4096 of a column. */
const REGION_EDGE_STEPS = 12;

/**
 * Where an inequality holds, as one rectangle per run of each horizontal band.
 * A run's ends are bisected onto the boundary, so the only stepping is the
 * band height (about 2px), and the boundary curve is drawn over that.
 */
function sampleRegion(
  inside: (x: number, y: number) => boolean,
  viewport: GraphViewport,
  columns: number,
  bands: number,
): number[] {
  const rects: number[] = [];
  const xStep = (viewport.xMax - viewport.xMin) / columns;
  const yStep = (viewport.yMax - viewport.yMin) / bands;
  const boundary = (y: number, a: number, b: number, aInside: boolean) => {
    for (let i = 0; i < REGION_EDGE_STEPS; i += 1) {
      const mid = (a + b) / 2;
      if (inside(mid, y) === aInside) a = mid;
      else b = mid;
    }
    return (a + b) / 2;
  };
  for (let band = 0; band < bands; band += 1) {
    const y0 = viewport.yMin + band * yStep;
    const y1 = viewport.yMin + (band + 1) * yStep;
    const y = (y0 + y1) / 2;
    let start: number | null = null;
    let previousX = viewport.xMin;
    let previousInside = false;
    for (let column = 0; column <= columns; column += 1) {
      const x = viewport.xMin + column * xStep;
      const isInside = inside(x, y);
      if (column === 0) {
        if (isInside) start = x;
      } else if (isInside !== previousInside) {
        const edge = boundary(y, previousX, x, previousInside);
        if (isInside) {
          start = edge;
        } else {
          rects.push(start!, y0, edge, y1);
          start = null;
        }
      }
      previousX = x;
      previousInside = isInside;
    }
    if (start !== null) rects.push(start, y0, viewport.xMax, y1);
  }
  return rects;
}

/** A boundary sampled as usual, with the region its inequality covers. */
function sampleInequality(
  parsed: ParsedGraphFunction,
  boundary: GraphSampleResult,
  options: GraphSampleOptions,
  samples: number,
  verticalSamples: number,
): GraphSampleResult {
  const op = parsed.inequality!;
  const f = parsed.createEvaluator(options.parameters);
  let inside: (x: number, y: number) => boolean;
  if (parsed.kind === 'implicit') {
    inside = (x, y) => satisfies(f(x, y), op);
  } else {
    // `y < f(x)` is `y - f(x) < 0`. Every band reads the same columns, so f
    // is evaluated once per x rather than once per band.
    const column = new Map<number, number>();
    inside = (x, y) => {
      let value = column.get(x);
      if (value === undefined) {
        value = f(x);
        column.set(x, value);
      }
      return satisfies(y - value, op);
    };
  }
  return {
    ...boundary,
    fill: sampleRegion(
      inside,
      options.viewport,
      Math.max(16, Math.round(samples / 2.8)),
      Math.max(16, Math.round(verticalSamples / 2.8)),
    ),
    strict: op === '<' || op === '>',
  };
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
  const verticalCount = clampToRange(
    Math.round(options.verticalSamples ?? options.samples),
    MIN_SAMPLES,
    MAX_SAMPLES,
  );
  const boundary =
    parsed.kind === 'implicit'
      ? sampleImplicitGraphExpression(
          parsed,
          viewport,
          parameters,
          count,
          verticalCount,
        )
      : sampleExplicitGraphExpression(parsed, viewport, parameters, count);
  return parsed.inequality
    ? sampleInequality(parsed, boundary, options, count, verticalCount)
    : boundary;
}

/**
 * Parse (cached) and sample one expression from a graph shape. With log
 * `axes` the segments come back in plot space (see `graph-scale`).
 */
export function sampleGraphExpression(
  expression: GraphExpression,
  viewport: GraphViewport,
  parameters: Record<string, GraphParameter>,
  samples: number,
  verticalSamples = samples,
  definitions: GraphFunctionDefinitions = EMPTY_GRAPH_FUNCTIONS,
  axes: GraphAxes = LINEAR_AXES,
  angleUnit: 'rad' | 'deg' = 'rad',
): GraphSampleResult {
  if (!expression.visible) return { ok: true, segments: [] };
  const parsed = parseGraphExpression(expression.expression, definitions);
  if (!parsed.ok) {
    return { ok: false, message: parsed.message, segments: [] };
  }
  return sampleParsedGraphExpression(warpParsed(parsed, axes), {
    viewport: toPlotViewport(viewport, axes),
    parameters,
    samples,
    verticalSamples,
    domain: parametricDomain(expression.domain, angleUnit),
  });
}
