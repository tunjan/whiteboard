/**
 * Logarithmic axes, as a change of coordinates.
 *
 * A graph with a log axis is sampled and drawn in *plot space*: each log axis
 * replaced by its log10, every other axis left alone. In plot space a log plot
 * is an ordinary linear one, so the sampler, the contour tracer, the region
 * filler, root finding and pan/zoom all work unchanged — they are handed the
 * plot-space viewport and an expression warped to read plot coordinates.
 *
 * The stored viewport stays in data units (`xMin: 0.01`), which is what the
 * panel shows and what a peer without log support would still read sensibly.
 */
import type { GraphProps, GraphViewport } from '@whiteboard/shared';
import type {
  ParsedGraphExpression,
  ParsedGraphFunction,
} from './graph-parser';

export interface GraphAxes {
  x: 'linear' | 'log';
  y: 'linear' | 'log';
}

export const LINEAR_AXES: GraphAxes = { x: 'linear', y: 'linear' };

export function graphAxes(
  props: Pick<GraphProps, 'xScale' | 'yScale'>,
): GraphAxes {
  return props.xScale === 'log' || props.yScale === 'log'
    ? { x: props.xScale ?? 'linear', y: props.yScale ?? 'linear' }
    : LINEAR_AXES;
}

export function isLinear(axes: GraphAxes): boolean {
  return axes.x === 'linear' && axes.y === 'linear';
}

/**
 * log10 that answers -Infinity for 0 and anything below it, rather than NaN
 * for the negatives. `y > f(x)` where f is negative then reads as every
 * positive y, which is the truth, instead of no y at all.
 */
function log10(value: number): number {
  return value > 0
    ? Math.log10(value)
    : Number.isNaN(value)
      ? value
      : -Infinity;
}

function axisTo(scale: GraphAxes['x'], value: number): number {
  return scale === 'log' ? log10(value) : value;
}

function axisFrom(scale: GraphAxes['x'], value: number): number {
  return scale === 'log' ? 10 ** value : value;
}

/** A data point → plot space. */
export function toPlot(point: { x: number; y: number }, axes: GraphAxes) {
  return { x: axisTo(axes.x, point.x), y: axisTo(axes.y, point.y) };
}

/** A plot-space point → data. */
export function fromPlot(point: { x: number; y: number }, axes: GraphAxes) {
  return { x: axisFrom(axes.x, point.x), y: axisFrom(axes.y, point.y) };
}

export function toPlotViewport(
  viewport: GraphViewport,
  axes: GraphAxes,
): GraphViewport {
  if (isLinear(axes)) return viewport;
  return {
    xMin: axisTo(axes.x, viewport.xMin),
    xMax: axisTo(axes.x, viewport.xMax),
    yMin: axisTo(axes.y, viewport.yMin),
    yMax: axisTo(axes.y, viewport.yMax),
  };
}

export function fromPlotViewport(
  viewport: GraphViewport,
  axes: GraphAxes,
): GraphViewport {
  if (isLinear(axes)) return viewport;
  return {
    xMin: axisFrom(axes.x, viewport.xMin),
    xMax: axisFrom(axes.x, viewport.xMax),
    yMin: axisFrom(axes.y, viewport.yMin),
    yMax: axisFrom(axes.y, viewport.yMax),
  };
}

/** Log axes can't show zero or below; a window that does isn't drawable. */
export function viewportFits(
  viewport: GraphViewport,
  axes: GraphAxes,
): boolean {
  return (
    viewport.xMin < viewport.xMax &&
    viewport.yMin < viewport.yMax &&
    (axes.x !== 'log' || viewport.xMin > 0) &&
    (axes.y !== 'log' || viewport.yMin > 0)
  );
}

/** Three decades below a positive max; [0.1, 100] when there is none. */
function logRange(min: number, max: number): [number, number] {
  if (min > 0 && min < max) return [min, max];
  if (max > 0) return [max / 1000, max];
  return [0.1, 100];
}

/**
 * The window to switch into `axes` with: the current one where it already
 * fits, else each log axis keeps its top and reaches three decades down.
 */
export function fitViewport(
  viewport: GraphViewport,
  axes: GraphAxes,
): GraphViewport {
  if (viewportFits(viewport, axes)) return viewport;
  const next = { ...viewport };
  if (axes.x === 'log')
    [next.xMin, next.xMax] = logRange(viewport.xMin, viewport.xMax);
  if (axes.y === 'log')
    [next.yMin, next.yMax] = logRange(viewport.yMin, viewport.yMax);
  return next;
}

/**
 * The expression, reading and answering in plot space. Linear axes hand back
 * `parsed` itself, so the common case allocates nothing.
 */
export function warpParsed(
  parsed: ParsedGraphExpression,
  axes: GraphAxes,
): ParsedGraphExpression {
  if (isLinear(axes)) return parsed;
  const X = (u: number) => axisFrom(axes.x, u);
  const Y = (v: number) => axisFrom(axes.y, v);
  const lx = (x: number) => axisTo(axes.x, x);
  const ly = (y: number) => axisTo(axes.y, y);

  if (parsed.kind === 'point' || parsed.kind === 'parametric') {
    const createEvaluator: typeof parsed.createEvaluator = (parameters) => {
      const at = parsed.createEvaluator(parameters);
      return (t) => {
        const point = at(t);
        return { x: lx(point.x), y: ly(point.y) };
      };
    };
    return {
      ...parsed,
      createEvaluator,
      evaluateAt: (t, parameters) => createEvaluator(parameters)(t),
    };
  }

  // An implicit relation keeps its sign under the change of coordinates, so
  // its zero set and its regions carry straight across. An explicit curve is
  // the graph of y = f(x), so its value moves into plot space too.
  const fn = parsed as ParsedGraphFunction;
  const createEvaluator: typeof fn.createEvaluator =
    fn.kind === 'implicit'
      ? (parameters) => {
          const f = fn.createEvaluator(parameters);
          return (u, v) => (v === undefined ? Number.NaN : f(X(u), Y(v)));
        }
      : (parameters) => {
          const f = fn.createEvaluator(parameters);
          return (u) => ly(f(X(u)));
        };
  return {
    ...fn,
    createEvaluator,
    evaluate: (x, parameters, y) => createEvaluator(parameters)(x, y),
  };
}
