import type {
  GraphExpression,
  GraphParameter,
  GraphParametricDomain,
  GraphProps,
  GraphViewport,
} from '@whiteboard/shared';
import { curveColors } from './graph-colors';

/** Selectable curve stroke widths, in screen pixels (strokes don't scale). */
export const GRAPH_CURVE_WIDTHS = [1.25, 2.25, 3.5, 5];

export const DEFAULT_GRAPH_CURVE_WIDTH = GRAPH_CURVE_WIDTHS[1]!;

export const DEFAULT_GRAPH_VIEWPORT: GraphViewport = {
  xMin: -10,
  xMax: 10,
  yMin: -10,
  yMax: 10,
};

export const DEFAULT_GRAPH_PARAMETER: GraphParameter = {
  value: 1,
  min: -10,
  max: 10,
  step: 0.1,
};

/** The free variable a coordinate expression sweeps to become a curve. */
export const PARAMETRIC_VARIABLE = 't';

/** One full turn, so `(cos(t), sin(t))` closes into a circle as typed. */
export const DEFAULT_PARAMETRIC_DOMAIN: GraphParametricDomain = {
  min: 0,
  max: Math.round(2 * Math.PI * 1000) / 1000,
};

/** The same turn for a graph in degrees. */
export const DEGREE_PARAMETRIC_DOMAIN: GraphParametricDomain = {
  min: 0,
  max: 360,
};

/** The domain a parametric expression is sampled over, falling back to the default. */
export function parametricDomain(
  domain: GraphParametricDomain | undefined,
  angleUnit: 'rad' | 'deg' = 'rad',
): GraphParametricDomain {
  if (
    !domain ||
    !Number.isFinite(domain.min) ||
    !Number.isFinite(domain.max) ||
    domain.min >= domain.max
  ) {
    return angleUnit === 'deg'
      ? DEGREE_PARAMETRIC_DOMAIN
      : DEFAULT_PARAMETRIC_DOMAIN;
  }
  return domain;
}

// The `color` here is a placeholder — createDefaultGraphProps overwrites it
// with the current theme's first palette swatch on every call, since this
// template is evaluated once at module load.
export const DEFAULT_GRAPH_PROPS: GraphProps = {
  w: 420,
  h: 280,
  viewport: DEFAULT_GRAPH_VIEWPORT,
  expressions: [
    {
      id: 'expr-default',
      expression: 'y = sin(x)',
      color: '#1d1d1d',
      visible: true,
      dash: 'solid',
      width: DEFAULT_GRAPH_CURVE_WIDTH,
    },
  ],
  parameters: {},
  showAxisLabels: true,
  points: [],
  showIntersections: false,
};

function cloneViewport(viewport: GraphViewport): GraphViewport {
  return { ...viewport };
}

export function createDefaultGraphProps(): GraphProps {
  return {
    ...DEFAULT_GRAPH_PROPS,
    viewport: cloneViewport(DEFAULT_GRAPH_VIEWPORT),
    expressions: DEFAULT_GRAPH_PROPS.expressions.map((expression) => ({
      ...expression,
      color: curveColors()[0]!.value,
    })),
    parameters: {},
    points: [],
  };
}

export function createGraphExpression(index: number): GraphExpression {
  const colors = curveColors();
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? `expr-${crypto.randomUUID()}`
        : `expr-${Date.now()}-${index}`,
    expression: '',
    color: colors[index % colors.length]!.value,
    visible: true,
    dash: 'solid',
    width: DEFAULT_GRAPH_CURVE_WIDTH,
  };
}
