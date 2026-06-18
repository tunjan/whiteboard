import type { GraphViewport } from '@whiteboard/shared';
import { formatAxisLabel, niceStep, tickValues } from '../grid';
import {
  createDefaultGraphProps,
  sampleGraphExpression,
} from '../graph-expressions';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { strokeDashArray, strokeLineCap } from './render-style';
import type { ShapeUtil } from './types';

const DEFAULT_W = 420;
const DEFAULT_H = 280;
const MIN_W = 220;
const MIN_H = 160;
const PLOT_PADDING = 16;
const CURVE_WIDTH = 2.25;

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

function plotArea(shape: { x: number; y: number; props: { w: number; h: number } }) {
  const x = shape.x + PLOT_PADDING;
  const y = shape.y + PLOT_PADDING;
  const w = Math.max(1, shape.props.w - PLOT_PADDING * 2);
  const h = Math.max(1, shape.props.h - PLOT_PADDING * 2);
  return { x, y, w, h };
}

function graphToScreen(
  point: { x: number; y: number },
  viewport: GraphViewport,
  area: { x: number; y: number; w: number; h: number },
) {
  const xRange = viewport.xMax - viewport.xMin || 1;
  const yRange = viewport.yMax - viewport.yMin || 1;
  return {
    x: area.x + ((point.x - viewport.xMin) / xRange) * area.w,
    y: area.y + ((viewport.yMax - point.y) / yRange) * area.h,
  };
}

function pathFromSegment(
  segment: { x: number; y: number }[],
  viewport: GraphViewport,
  area: { x: number; y: number; w: number; h: number },
): string {
  return segment
    .map((point, index) => {
      const screen = graphToScreen(point, viewport, area);
      return `${index === 0 ? 'M' : 'L'}${screen.x.toFixed(2)} ${screen.y.toFixed(2)}`;
    })
    .join(' ');
}

function stepFor(range: number, size: number): number {
  const targetCount = Math.max(2, Math.floor(size / 70));
  return niceStep(Math.abs(range) / targetCount);
}

export const graphUtil: ShapeUtil<'graph'> = {
  type: 'graph',
  canResize: true,

  getDefaultProps: () => createDefaultGraphProps(),

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
    const props = shape.props;
    const area = plotArea(shape);
    const viewport = props.viewport;
    const xStep = stepFor(viewport.xMax - viewport.xMin, area.w);
    const yStep = stepFor(viewport.yMax - viewport.yMin, area.h);
    const xTicks = tickValues(viewport.xMin, viewport.xMax, xStep);
    const yTicks = tickValues(viewport.yMin, viewport.yMax, yStep);
    const xAxis = graphToScreen({ x: 0, y: 0 }, viewport, area).y;
    const yAxis = graphToScreen({ x: 0, y: 0 }, viewport, area).x;
    const clippedXAxis = Math.max(area.y, Math.min(area.y + area.h, xAxis));
    const clippedYAxis = Math.max(area.x, Math.min(area.x + area.w, yAxis));
    const clipId = `graph-clip-${safeId(shape.id)}`;
    const shadowId = `graph-shadow-${safeId(shape.id)}`;
    const samples = Math.max(180, Math.round(area.w * 1.4));
    const showAxisLabels = props.showAxisLabels !== false;
    const xLabelsBelow = clippedXAxis <= area.y + area.h - 18;
    const xLabelY = xLabelsBelow ? clippedXAxis + 13 : clippedXAxis - 7;
    const yLabelsRight = clippedYAxis <= area.x + area.w - 34;
    const yLabelX = yLabelsRight ? clippedYAxis + 6 : clippedYAxis - 6;
    const yLabelAnchor = yLabelsRight ? 'start' : 'end';
    const axisLabelStyle = {
      fontSize: 10,
      fill: 'var(--color-muted-foreground)',
      stroke: 'var(--color-background)',
      strokeWidth: 3,
      paintOrder: 'stroke' as const,
    };

    return (
      <g transform={rotationTransform(shape.x, shape.y, props.w, props.h, shape.rotation)}>
        <defs>
          <filter
            id={shadowId}
            x={shape.x - 28}
            y={shape.y - 20}
            width={props.w + 56}
            height={props.h + 64}
            filterUnits="userSpaceOnUse"
            colorInterpolationFilters="sRGB"
          >
            <feDropShadow
              dx={0}
              dy={8}
              stdDeviation={8}
              floodColor="black"
              floodOpacity={0.13}
            />
          </filter>
          <clipPath id={clipId}>
            <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={4} />
          </clipPath>
        </defs>

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
          filter={`url(#${shadowId})`}
        />

        <rect
          x={area.x}
          y={area.y}
          width={area.w}
          height={area.h}
          rx={4}
          fill="var(--color-background)"
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        <g clipPath={`url(#${clipId})`}>
          {xTicks.map((x) => {
            const screen = graphToScreen({ x, y: 0 }, viewport, area);
            return (
              <line
                key={`x-grid-${x}`}
                x1={screen.x}
                y1={area.y}
                x2={screen.x}
                y2={area.y + area.h}
                stroke="var(--grid-minor)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {yTicks.map((y) => {
            const screen = graphToScreen({ x: 0, y }, viewport, area);
            return (
              <line
                key={`y-grid-${y}`}
                x1={area.x}
                y1={screen.y}
                x2={area.x + area.w}
                y2={screen.y}
                stroke="var(--grid-minor)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <line
            x1={area.x}
            y1={clippedXAxis}
            x2={area.x + area.w}
            y2={clippedXAxis}
            stroke="var(--grid-axis)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={clippedYAxis}
            y1={area.y}
            x2={clippedYAxis}
            y2={area.y + area.h}
            stroke="var(--grid-axis)"
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
          {props.expressions.map((expression) => {
            const result = sampleGraphExpression(
              expression,
              viewport,
              props.parameters,
              samples,
            );
            if (!result.ok || !result.segments.length) return null;
            return result.segments.map((segment, index) => (
              <path
                key={`${expression.id}-${index}`}
                d={pathFromSegment(segment, viewport, area)}
                fill="none"
                stroke={expression.color}
                strokeWidth={CURVE_WIDTH}
                strokeLinecap={strokeLineCap(expression.dash) ?? 'round'}
                strokeLinejoin="round"
                strokeDasharray={strokeDashArray(expression.dash, CURVE_WIDTH)}
                vectorEffect="non-scaling-stroke"
              />
            ));
          })}
          {showAxisLabels
            ? xTicks.map((x) => {
                if (x === 0) return null;
                const screen = graphToScreen({ x, y: 0 }, viewport, area);
                return (
                  <text
                    key={`x-label-${x}`}
                    x={screen.x}
                    y={xLabelY}
                    textAnchor="middle"
                    {...axisLabelStyle}
                  >
                    {formatAxisLabel(x)}
                  </text>
                );
              })
            : null}
          {showAxisLabels
            ? yTicks.map((y) => {
                if (y === 0) return null;
                const screen = graphToScreen({ x: 0, y }, viewport, area);
                return (
                  <text
                    key={`y-label-${y}`}
                    x={yLabelX}
                    y={screen.y}
                    textAnchor={yLabelAnchor}
                    dominantBaseline="middle"
                    {...axisLabelStyle}
                  >
                    {formatAxisLabel(y)}
                  </text>
                );
              })
            : null}
          {showAxisLabels ? (
            <text
              x={yLabelX}
              y={xLabelY}
              textAnchor={yLabelAnchor}
              {...axisLabelStyle}
            >
              0
            </text>
          ) : null}
        </g>
      </g>
    );
  },
};

export const GRAPH_DEFAULT_SIZE = { w: DEFAULT_W, h: DEFAULT_H };
