/**
 * A 3D graph as flat drawing: sample every row into faces, runs and dots in
 * graph units, then project them onto the plot and paint far to near.
 *
 * Painting in depth order (the painter's algorithm) rather than with a depth
 * buffer keeps the plot plain SVG, so PNG export, the canvas-2d renderer's DOM
 * hand-off and theming all work as they do for a 2D graph. Its known limit is
 * where two surfaces cross: each facet is ordered as a whole, so the seam
 * zigzags at facet size. Faces are translucent, which hides most of that.
 *
 * Coordinates: z is up. The box is normalised to a cube, so a plot reads the
 * same however different the three ranges are. The view is orthographic:
 * parallel lines stay parallel, as they are drawn in a textbook.
 */
import type {
  Graph3dView,
  GraphExpression,
  GraphParameter,
  GraphViewport,
} from '@whiteboard/shared';
import { parametricDomain } from './graph-defaults';
import {
  parseGraph3dExpression,
  type GraphFunctionDefinitions,
  type GraphPoint3,
} from './graph-parser';
import { axisTicks } from './graph-ticks';
import type { PlotArea } from './shapes/graph-interaction';

type Axis = 'x' | 'y' | 'z';
const AXES: readonly Axis[] = ['x', 'y', 'z'];

/** The angle a graph first shows in 3D: x toward you on the left, y to the right. */
export const DEFAULT_GRAPH_3D_ANGLE = { yaw: -125, pitch: 25 } as const;

/** Degrees of turn per pixel dragged. */
const ORBIT_DEG_PER_PX = 0.5;

/**
 * Facets per side of a surface; the low figure is for a zoomed-out board.
 * ponytail: one SVG node per facet bounds this. Measured per turn step on a
 * dev build with a surface, a plane and a helix: 32² ~8 ms, 40² ~24 ms. A
 * finer mesh wants the plot drawn into a canvas instead.
 */
const SURFACE_CELLS = { high: 32, low: 16 } as const;
/** A plane is flat, so it only needs enough facets to sort against others. */
const PLANE_CELLS = 12;
const CURVE_SAMPLES = 240;
/** Segments per run. Shorter sorts better against faces, longer is fewer nodes. */
const RUN_SEGMENTS = 6;
/** Pieces a straight line (a vector line, an axis, a box edge) is cut into. */
const LINE_PIECES = 12;
const BOX_EDGE_PIECES = 4;

/** Where a primitive came from: a row of the graph, or the frame around it. */
export type Source = number | 'box' | 'axis';

/** Something to draw, in graph units. */
export type Primitive3 =
  | { kind: 'face'; points: GraphPoint3[]; source: Source; plane: boolean }
  | { kind: 'run'; points: GraphPoint3[]; source: Source }
  | { kind: 'dot'; point: GraphPoint3; source: Source };

export interface Box3 {
  min: GraphPoint3;
  max: GraphPoint3;
}

export function graphBox(viewport: GraphViewport, view: Graph3dView): Box3 {
  return {
    min: { x: viewport.xMin, y: viewport.yMin, z: view.zMin },
    max: { x: viewport.xMax, y: viewport.yMax, z: view.zMax },
  };
}

function finite(p: GraphPoint3): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

function lerp(a: GraphPoint3, b: GraphPoint3, t: number): GraphPoint3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/** Assemble a point from values along three named axes. */
function compose(axes: readonly [Axis, Axis, Axis], a: number, b: number, c: number): GraphPoint3 {
  const p = { x: 0, y: 0, z: 0 };
  p[axes[0]] = a;
  p[axes[1]] = b;
  p[axes[2]] = c;
  return p;
}

/**
 * The part of `polygon` on one side of the plane `axis = bound`
 * (one Sutherland–Hodgman pass).
 */
function clipPolygon(
  polygon: readonly GraphPoint3[],
  axis: Axis,
  bound: number,
  keepAbove: boolean,
): GraphPoint3[] {
  const out: GraphPoint3[] = [];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % polygon.length]!;
    const da = keepAbove ? a[axis] - bound : bound - a[axis];
    const db = keepAbove ? b[axis] - bound : bound - b[axis];
    if (da >= 0) out.push(a);
    if (da >= 0 !== db >= 0) out.push(lerp(a, b, da / (da - db)));
  }
  return out;
}

/**
 * The parameter span `[t0, t1]` of `a + t(b − a)` inside the box (slab
 * method), or null when it misses. `unbounded` drops the segment's own ends,
 * for a line rather than a segment.
 */
export function clipToBox(
  a: GraphPoint3,
  b: GraphPoint3,
  box: Box3,
  unbounded = false,
): [number, number] | null {
  let t0 = unbounded ? -Infinity : 0;
  let t1 = unbounded ? Infinity : 1;
  for (const axis of AXES) {
    const d = b[axis] - a[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (d === 0) {
      if (a[axis] < lo || a[axis] > hi) return null;
      continue;
    }
    let enter = (lo - a[axis]) / d;
    let exit = (hi - a[axis]) / d;
    if (enter > exit) [enter, exit] = [exit, enter];
    t0 = Math.max(t0, enter);
    t1 = Math.min(t1, exit);
    if (t0 > t1) return null;
  }
  return Number.isFinite(t0) && Number.isFinite(t1) ? [t0, t1] : null;
}

/**
 * Facets of `w = f(u, v)` over the box, each clipped to the box's w range.
 * A facet with any corner off the function's domain is left out, so a surface
 * like `sqrt(1 - x^2 - y^2)` ends a facet short of its true edge.
 */
function heightField(
  f: (u: number, v: number) => number,
  axes: readonly [Axis, Axis, Axis],
  box: Box3,
  cells: number,
  source: Source,
  plane: boolean,
  out: Primitive3[],
): void {
  const [u, v, w] = axes;
  const n = cells + 1;
  const us = Array.from({ length: n }, (_, i) => box.min[u] + ((box.max[u] - box.min[u]) * i) / cells);
  const vs = Array.from({ length: n }, (_, j) => box.min[v] + ((box.max[v] - box.min[v]) * j) / cells);
  const ws = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) ws[i * n + j] = f(us[i]!, vs[j]!);
  }
  const corner = (i: number, j: number) => compose(axes, us[i]!, vs[j]!, ws[i * n + j]!);
  for (let i = 0; i < cells; i += 1) {
    for (let j = 0; j < cells; j += 1) {
      const corners = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
      if (!corners.every((p) => Number.isFinite(p[w]))) continue;
      const clipped = clipPolygon(
        clipPolygon(corners, w, box.min[w], true),
        w,
        box.max[w],
        false,
      );
      if (clipped.length >= 3) out.push({ kind: 'face', points: clipped, source, plane });
    }
  }
}

/** Cut a polyline into runs of {@link RUN_SEGMENTS} segments that share ends. */
function pushRuns(points: readonly GraphPoint3[], source: Source, out: Primitive3[]): void {
  for (let start = 0; start < points.length - 1; start += RUN_SEGMENTS) {
    out.push({
      kind: 'run',
      points: points.slice(start, Math.min(points.length, start + RUN_SEGMENTS + 1)),
      source,
    });
  }
}

/** A straight piece from `a` to `b`, cut so it sorts against what it passes. */
function pushStraight(
  a: GraphPoint3,
  b: GraphPoint3,
  pieces: number,
  source: Source,
  out: Primitive3[],
): void {
  pushRuns(
    Array.from({ length: pieces + 1 }, (_, i) => lerp(a, b, i / pieces)),
    source,
    out,
  );
}

/** A sampled curve, broken where it leaves the box or its domain. */
function pushCurve(samples: readonly GraphPoint3[], box: Box3, source: Source, out: Primitive3[]): void {
  let run: GraphPoint3[] = [];
  const flush = () => {
    if (run.length >= 2) pushRuns(run, source, out);
    run = [];
  };
  for (let i = 1; i < samples.length; i += 1) {
    const a = samples[i - 1]!;
    const b = samples[i]!;
    const span = finite(a) && finite(b) ? clipToBox(a, b, box) : null;
    if (!span) {
      flush();
      continue;
    }
    const [t0, t1] = span;
    if (run.length === 0 || t0 > 0) {
      flush();
      run.push(lerp(a, b, t0));
    }
    run.push(lerp(a, b, t1));
    if (t1 < 1) flush();
  }
  flush();
}

function inBox(p: GraphPoint3, box: Box3): boolean {
  return AXES.every((axis) => {
    const slack = (box.max[axis] - box.min[axis]) * 1e-9;
    return p[axis] >= box.min[axis] - slack && p[axis] <= box.max[axis] + slack;
  });
}

/** The 12 edges of the box. */
function boxEdges(box: Box3): [GraphPoint3, GraphPoint3][] {
  const edges: [GraphPoint3, GraphPoint3][] = [];
  for (const axis of AXES) {
    const [p, q] = AXES.filter((a) => a !== axis) as [Axis, Axis];
    for (const pv of [box.min[p], box.max[p]]) {
      for (const qv of [box.min[q], box.max[q]]) {
        const a = { ...box.min };
        a[p] = pv;
        a[q] = qv;
        edges.push([a, { ...a, [axis]: box.max[axis] }]);
      }
    }
  }
  return edges;
}

export interface Scene3dInput {
  expressions: readonly GraphExpression[];
  parameters: Record<string, GraphParameter>;
  definitions: GraphFunctionDefinitions;
  box: Box3;
  angleUnit: 'rad' | 'deg';
  detail: 'high' | 'low';
}

/**
 * Everything a 3D graph draws, in graph units: the box and axes, then each
 * visible row. It depends on the rows, sliders and ranges but not the angle,
 * so a rotation re-projects the same scene without sampling again.
 */
export function buildScene3d(input: Scene3dInput): Primitive3[] {
  const { box } = input;
  const out: Primitive3[] = [];
  for (const [a, b] of boxEdges(box)) pushStraight(a, b, BOX_EDGE_PIECES, 'box', out);
  // An axis is drawn where it passes through the box: x where y = z = 0.
  for (const axis of AXES) {
    const origin = { x: 0, y: 0, z: 0 };
    if (!AXES.every((other) => other === axis || (box.min[other] <= 0 && box.max[other] >= 0))) {
      continue;
    }
    pushStraight(
      { ...origin, [axis]: box.min[axis] },
      { ...origin, [axis]: box.max[axis] },
      LINE_PIECES,
      'axis',
      out,
    );
  }

  input.expressions.forEach((expression, row) => {
    if (!expression.visible || !expression.expression.trim()) return;
    const parsed = parseGraph3dExpression(expression.expression, input.definitions);
    if (!parsed.ok) return;
    switch (parsed.kind) {
      case 'surface': {
        const f = parsed.createEvaluator(input.parameters);
        heightField(f, ['x', 'y', 'z'], box, SURFACE_CELLS[input.detail], row, false, out);
        return;
      }
      case 'plane': {
        const plane = parsed.createPlane(input.parameters);
        if (!plane) return;
        const { normal: n, offset } = plane;
        // Solved for whichever axis it is steepest along on screen, measured
        // in the normalised cube, so its facets never stand on edge.
        const weight = (axis: Axis) => Math.abs(n[axis] * (box.max[axis] - box.min[axis]));
        const w = AXES.reduce((best, axis) => (weight(axis) > weight(best) ? axis : best));
        const [u, v] = AXES.filter((axis) => axis !== w) as [Axis, Axis];
        heightField(
          (a, b) => (offset - n[u] * a - n[v] * b) / n[w],
          [u, v, w],
          box,
          PLANE_CELLS,
          row,
          true,
          out,
        );
        return;
      }
      case 'point': {
        const p = parsed.createEvaluator(input.parameters)(0);
        if (finite(p) && inBox(p, box)) out.push({ kind: 'dot', point: p, source: row });
        return;
      }
      case 'line': {
        const at = parsed.createEvaluator(input.parameters);
        const a = at(0);
        const b = at(1);
        const span = finite(a) && finite(b) ? clipToBox(a, b, box, true) : null;
        if (span) pushStraight(lerp(a, b, span[0]), lerp(a, b, span[1]), LINE_PIECES, row, out);
        return;
      }
      case 'curve': {
        const at = parsed.createEvaluator(input.parameters);
        const { min, max } = parametricDomain(expression.domain, input.angleUnit);
        const samples = Array.from({ length: CURVE_SAMPLES + 1 }, (_, i) =>
          at(min + ((max - min) * i) / CURVE_SAMPLES),
        );
        pushCurve(samples, box, row, out);
        return;
      }
      case 'definition':
        return;
    }
  });
  return out;
}

/* ─── Projection ─────────────────────────────────────────────────────────── */

export interface ScreenPoint {
  x: number;
  y: number;
  /** Toward the viewer, in cube units: larger is nearer. */
  depth: number;
}

export interface Projection {
  project(p: GraphPoint3): ScreenPoint;
  /** Screen centre of the box. */
  center: { x: number; y: number };
  /** Toward-viewer direction of a cube-space vector, for shading. */
  view(v: GraphPoint3): GraphPoint3;
}

/**
 * Orthographic view of the box inside `area`. The scale fits the cube's
 * diagonal, so the box never leaves the plot and doesn't grow and shrink as
 * it turns.
 */
export function createProjection(
  box: Box3,
  angle: { yaw: number; pitch: number },
  area: PlotArea,
): Projection {
  const yaw = (angle.yaw * Math.PI) / 180;
  const pitch = (angle.pitch * Math.PI) / 180;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const half = (axis: Axis) => (box.max[axis] - box.min[axis]) / 2 || 1;
  const mid = (axis: Axis) => (box.max[axis] + box.min[axis]) / 2;
  const hx = half('x');
  const hy = half('y');
  const hz = half('z');
  const mx = mid('x');
  const my = mid('y');
  const mz = mid('z');
  // Room for the tick labels outside the box.
  const scale = Math.min(area.w, area.h) / 2 / (Math.sqrt(3) + 0.12);
  const center = { x: area.x + area.w / 2, y: area.y + area.h / 2 };

  // Turned about z by yaw, then tipped toward the viewer by pitch: right,
  // up and toward-viewer components of a cube-space vector.
  const view = (q: GraphPoint3): GraphPoint3 => {
    const x1 = q.x * cy - q.y * sy;
    const y1 = q.x * sy + q.y * cy;
    return { x: x1, y: y1 * sp + q.z * cp, z: -y1 * cp + q.z * sp };
  };
  return {
    center,
    view,
    project(p) {
      const v = view({ x: (p.x - mx) / hx, y: (p.y - my) / hy, z: (p.z - mz) / hz });
      return { x: center.x + v.x * scale, y: center.y - v.y * scale, depth: v.z };
    },
  };
}

/** Turn a view by a drag of `dx`, `dy` screen pixels: the box follows the pointer. */
export function orbitView(view: Graph3dView, dx: number, dy: number): Graph3dView {
  const yaw = view.yaw + dx * ORBIT_DEG_PER_PX;
  return {
    ...view,
    // Kept in (−180, 180] so it never runs away over a long session.
    yaw: yaw - 360 * Math.ceil((yaw - 180) / 360),
    pitch: Math.max(-90, Math.min(90, view.pitch + dy * ORBIT_DEG_PER_PX)),
  };
}

/** Grow (factor > 1) or shrink all three ranges about their middles. */
export function zoomGraph3d(
  viewport: GraphViewport,
  view: Graph3dView,
  factor: number,
): { viewport: GraphViewport; view3d: Graph3dView } {
  const scale = (min: number, max: number): [number, number] => {
    const mid = (min + max) / 2;
    const half = ((max - min) / 2) * factor;
    return [mid - half, mid + half];
  };
  const [xMin, xMax] = scale(viewport.xMin, viewport.xMax);
  const [yMin, yMax] = scale(viewport.yMin, viewport.yMax);
  const [zMin, zMax] = scale(view.zMin, view.zMax);
  return { viewport: { xMin, xMax, yMin, yMax }, view3d: { ...view, zMin, zMax } };
}

export type Placed3 =
  | {
      kind: 'face';
      points: ScreenPoint[];
      source: Source;
      plane: boolean;
      /** 0 (edge-on to the light) to 1 (facing it). */
      light: number;
    }
  | { kind: 'run'; points: ScreenPoint[]; source: Source }
  | { kind: 'dot'; point: ScreenPoint; source: Source };

/** From the upper left, a little in front: the usual studio key light. */
const LIGHT = (() => {
  const v = { x: -0.4, y: 0.6, z: 0.7 };
  const l = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / l, y: v.y / l, z: v.z / l };
})();

/** Newell's normal of a polygon given in view space, normalised. */
function viewNormal(points: readonly GraphPoint3[]): GraphPoint3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    x += (a.y - b.y) * (a.z + b.z);
    y += (a.z - b.z) * (a.x + b.x);
    z += (a.x - b.x) * (a.y + b.y);
  }
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

function meanDepth(points: readonly ScreenPoint[]): number {
  let sum = 0;
  for (const p of points) sum += p.depth;
  return sum / points.length;
}

/**
 * Project a scene and order it far to near. A face is lit from both sides,
 * so a surface seen from below reads as solid as one seen from above.
 */
export function projectScene(scene: readonly Primitive3[], projection: Projection, box: Box3): Placed3[] {
  const cube = (p: GraphPoint3): GraphPoint3 => ({
    x: (2 * (p.x - box.min.x)) / (box.max.x - box.min.x || 1) - 1,
    y: (2 * (p.y - box.min.y)) / (box.max.y - box.min.y || 1) - 1,
    z: (2 * (p.z - box.min.z)) / (box.max.z - box.min.z || 1) - 1,
  });
  const placed = scene.map((primitive): { item: Placed3; depth: number } => {
    switch (primitive.kind) {
      case 'face': {
        const points = primitive.points.map(projection.project);
        const n = viewNormal(primitive.points.map((p) => projection.view(cube(p))));
        const light = Math.abs(n.x * LIGHT.x + n.y * LIGHT.y + n.z * LIGHT.z);
        return {
          item: { kind: 'face', points, source: primitive.source, plane: primitive.plane, light },
          depth: meanDepth(points),
        };
      }
      case 'run': {
        const points = primitive.points.map(projection.project);
        return { item: { kind: 'run', points, source: primitive.source }, depth: meanDepth(points) };
      }
      case 'dot': {
        const point = projection.project(primitive.point);
        return { item: { kind: 'dot', point, source: primitive.source }, depth: point.depth };
      }
    }
  });
  // Stable, so equal depths keep build order: box, axes, then rows in order.
  placed.sort((a, b) => a.depth - b.depth);
  return placed.map(({ item }) => item);
}

/* ─── Axis labels ────────────────────────────────────────────────────────── */

export interface AxisLabel3 {
  axis: Axis;
  /** Tick numbers along the box edge chosen for this axis. */
  ticks: { x: number; y: number; text: string }[];
  /** Where the axis's letter goes. */
  name: { x: number; y: number };
}

/** Edges shorter than this on screen point at the viewer and carry no numbers. */
const MIN_LABELLED_EDGE_PX = 24;
const TICK_LABEL_GAP = 12;
const AXIS_NAME_GAP = 30;
/**
 * A tick number's box, roughly: 10px tabular digits, padded so two numbers
 * meeting at a corner don't read as one ("5 5").
 */
const LABEL_CHAR_PX = 6;
const LABEL_PAD_PX = 10;
const LABEL_HEIGHT_PX = 14;

interface LabelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h;
}

/**
 * Numbers and a letter for each axis, along one of the four box edges that
 * run its way: for x and y the lowest on screen, for z the leftmost. Both are
 * on the box's outline, so the numbers never sit inside the drawing. Where two
 * labelled edges meet, a number that would overprint another is left out.
 */
export function axisLabels3d(box: Box3, projection: Projection): AxisLabel3[] {
  const center = projection.center;
  const edges = AXES.map((axis) => {
    const [p, q] = AXES.filter((a) => a !== axis) as [Axis, Axis];
    let best: { a: ScreenPoint; b: ScreenPoint; from: GraphPoint3; to: GraphPoint3 } | null = null;
    let bestScore = -Infinity;
    for (const pv of [box.min[p], box.max[p]]) {
      for (const qv of [box.min[q], box.max[q]]) {
        const from = { ...box.min, [p]: pv, [q]: qv };
        const to = { ...from, [axis]: box.max[axis] };
        const a = projection.project(from);
        const b = projection.project(to);
        const midX = (a.x + b.x) / 2;
        const midY = (a.y + b.y) / 2;
        // Ties (an edge-on view) go to the edge nearer the viewer.
        const score = (axis === 'z' ? -midX : midY) + (a.depth + b.depth) * 1e-6;
        if (score > bestScore) {
          bestScore = score;
          best = { a, b, from, to };
        }
      }
    }
    const { a, b, from, to } = best!;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const out = { x: mid.x - center.x, y: mid.y - center.y };
    const outLength = Math.hypot(out.x, out.y) || 1;
    return {
      axis,
      from,
      to,
      length: Math.hypot(b.x - a.x, b.y - a.y),
      out: { x: out.x / outLength, y: out.y / outLength },
      name: {
        x: mid.x + (out.x / outLength) * AXIS_NAME_GAP,
        y: mid.y + (out.y / outLength) * AXIS_NAME_GAP,
      },
    };
  });

  // The letters go down first: they matter more than any one number.
  const taken: LabelBox[] = edges.map(({ name }) => ({ ...name, w: 8, h: 10 }));
  return edges.map(({ axis, from, to, length, out, name }) => {
    const min = box.min[axis];
    const max = box.max[axis];
    const ticks: AxisLabel3['ticks'] = [];
    if (length >= MIN_LABELLED_EDGE_PX) {
      for (const { at, label } of axisTicks(min, max, length, 'linear').major) {
        if (label === null) continue;
        const s = projection.project(lerp(from, to, (at - min) / (max - min)));
        const tick = { x: s.x + out.x * TICK_LABEL_GAP, y: s.y + out.y * TICK_LABEL_GAP, text: label };
        const bounds = { ...tick, w: label.length * LABEL_CHAR_PX + LABEL_PAD_PX, h: LABEL_HEIGHT_PX };
        if (taken.some((other) => overlaps(bounds, other))) continue;
        taken.push(bounds);
        ticks.push(tick);
      }
    }
    return { axis, ticks, name };
  });
}

/**
 * A hex colour lit by `light`, 0 to 1: toward white where a face meets the
 * light and toward black where it turns away, so even a black surface shows
 * its shape. Anything but `#rrggbb` comes back as given.
 */
export function tone(color: string, light: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return color;
  const n = Number.parseInt(match[1]!, 16);
  const toward = light >= 0.5 ? 255 : 0;
  const amount = Math.min(1, Math.abs(light - 0.5) * 0.8);
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (toward - c) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}
