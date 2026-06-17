import { useEffect, useMemo, useRef, useState } from 'react';
import functionPlotModule, { type FunctionPlotOptions } from 'function-plot';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import type { ShapeUtil } from './types';
import {
  expressionForFunctionPlot,
  validatePlotExpression,
  validatePlotProps,
} from '../plot-expressions';

const DEFAULT_W = 360;
const DEFAULT_H = 260;
const MIN_W = 180;
const MIN_H = 140;

type FunctionPlotCallable = (options: FunctionPlotOptions) => unknown;

function resolveFunctionPlot(module: unknown): FunctionPlotCallable {
  if (typeof module === 'function') return module as FunctionPlotCallable;
  if (module && typeof module === 'object') {
    const firstDefault = (module as { default?: unknown }).default;
    if (typeof firstDefault === 'function') {
      return firstDefault as FunctionPlotCallable;
    }
    if (firstDefault && typeof firstDefault === 'object') {
      const secondDefault = (firstDefault as { default?: unknown }).default;
      if (typeof secondDefault === 'function') {
        return secondDefault as FunctionPlotCallable;
      }
    }
  }
  throw new Error('function-plot export is not callable');
}

const functionPlot = resolveFunctionPlot(functionPlotModule);

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to render plot';
}

export const plotUtil: ShapeUtil<'plot'> = {
  type: 'plot',
  canResize: true,

  getDefaultProps: () => ({
    w: DEFAULT_W,
    h: DEFAULT_H,
    xMin: -10,
    xMax: 10,
    yMin: -10,
    yMax: 10,
    showGrid: true,
    curves: [
      {
        id: 'curve-default',
        expression: 'sin(x)',
        color: '#2f6df6',
        enabled: true,
      },
    ],
  }),

  getBounds: (s) => boxBounds(s.x, s.y, s.props.w, s.props.h),

  hitTest: (s, p, tol) =>
    boxHitTest(s.x, s.y, s.props.w, s.props.h, s.rotation, p, tol),

  resize: (initial, nb) => ({
    x: nb.minX,
    y: nb.minY,
    props: {
      ...initial.props,
      w: Math.max(MIN_W, nb.maxX - nb.minX),
      h: Math.max(MIN_H, nb.maxY - nb.minY),
    },
  }),

  Component: ({ shape }) => {
    const hostRef = useRef<HTMLDivElement>(null);
    const [renderError, setRenderError] = useState<string | null>(null);
    const props = shape.props;
    const enabledCurves = useMemo(
      () =>
        props.curves.filter(
          (curve) => curve.enabled && validatePlotExpression(curve.expression).ok,
        ),
      [props.curves],
    );
    const plotKey = useMemo(
      () =>
        JSON.stringify({
          w: Math.round(props.w),
          h: Math.round(props.h),
          xMin: props.xMin,
          xMax: props.xMax,
          yMin: props.yMin,
          yMax: props.yMax,
          showGrid: props.showGrid,
          curves: enabledCurves.map((curve) => ({
            expression: expressionForFunctionPlot(curve.expression),
            color: curve.color,
          })),
        }),
      [enabledCurves, props.h, props.showGrid, props.w, props.xMax, props.xMin, props.yMax, props.yMin],
    );

    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      host.innerHTML = '';

      const validation = validatePlotProps(props);
      if (!validation.ok) {
        setRenderError(validation.message ?? 'Invalid plot');
        return;
      }

      try {
        functionPlot({
          target: host,
          width: Math.max(MIN_W, props.w),
          height: Math.max(MIN_H, props.h),
          grid: props.showGrid,
          disableZoom: true,
          xAxis: {
            domain: [props.xMin, props.xMax],
            position: 'sticky',
          },
          yAxis: {
            domain: [props.yMin, props.yMax],
            position: 'sticky',
          },
          tip: { xLine: false, yLine: false },
          data: enabledCurves.map((curve) => ({
            fn: expressionForFunctionPlot(curve.expression),
            graphType: 'polyline',
            sampler: 'builtIn',
            nSamples: Math.max(180, Math.round(props.w)),
            color: curve.color,
            range: [props.xMin, props.xMax],
            attr: {
              'stroke-width': 2,
              'stroke-linecap': 'round',
              'stroke-linejoin': 'round',
            },
          })),
        });
        setRenderError(null);
      } catch (error) {
        host.innerHTML = '';
        setRenderError(errorText(error));
      }

      return () => {
        host.innerHTML = '';
      };
    }, [plotKey, props, enabledCurves]);

    return (
      <g transform={rotationTransform(shape.x, shape.y, props.w, props.h, shape.rotation)}>
        <rect
          x={shape.x}
          y={shape.y}
          width={props.w}
          height={props.h}
          rx={8}
          fill="var(--color-card)"
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
        <foreignObject
          x={shape.x}
          y={shape.y}
          width={props.w}
          height={props.h}
          style={{ pointerEvents: 'none' }}
        >
          <div className="plot-card-host">
            <div ref={hostRef} className="plot-card-target" />
            {renderError ? (
              <div className="plot-card-error">
                <div className="plot-card-error-title">Plot error</div>
                <div>{renderError}</div>
              </div>
            ) : null}
          </div>
        </foreignObject>
      </g>
    );
  },
};
