import { useEffect, useMemo, useRef } from 'react';
import type { GraphViewport } from '@whiteboard/shared';
import { formatAxisLabel, niceStep, tickValues } from '../grid';
import {
  DEFAULT_GRAPH_CURVE_WIDTH,
  createDefaultGraphProps,
} from '../graph-defaults';
import { useGraphMathReady } from '../graph-math';
import { mergeGraphParameters } from '../graph-parameters';
import { createGraphFunctionDefinitions } from '../graph-parser';
import { useGraphCurves } from '../graph-sample-client';
import { useGraphAnimationStore } from '../use-graph-animation-store';
import { formatIntersectionLabel } from '../graph-intersections';
import { placePointLabels, type LabelBox } from '../graph-label-layout';
import { useLodDetail } from '../lod';
import { normalizeWheelDelta } from '../use-wheel';
import { breakUndoCapture, editor } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { graphToScreen, panViewport, zoomViewport } from './graph-interaction';
import { GraphTrace } from './graph-trace';
import { createGraphViewportWriter } from './graph-viewport-writer';
import { PaintedShadow, roundedRectPath } from './painted-shadow';
import { polylineLength } from './perfect-dash';
import { dashProps, strokeLineCap } from './render-style';
import { measureTextWidth } from './text-measure';
import type { ShapeUtil } from './types';

const DEFAULT_W = 420;
const DEFAULT_H = 280;
const MIN_W = 220;
const MIN_H = 160;
const PLOT_PADDING = 16;
// Wheel-zoom feel, mirrored from the board camera (use-wheel.ts).
const WHEEL_MAX_ZOOM_DELTA = 10;
// Continuous wheel gestures coalesce into one undo step until this idle gap.
const WHEEL_UNDO_IDLE_MS = 300;

function clampNum(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function plotArea(shape: { x: number; y: number; props: { w: number; h: number } }) {
  const x = shape.x + PLOT_PADDING;
  const y = shape.y + PLOT_PADDING;
  const w = Math.max(1, shape.props.w - PLOT_PADDING * 2);
  const h = Math.max(1, shape.props.h - PLOT_PADDING * 2);
  return { x, y, w, h };
}

function pathFromPoints(points: readonly { x: number; y: number }[]): string {
  return points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
    )
    .join(' ');
}

/** An inequality's region rectangles (see `GraphSampleResult.fill`) as one path. */
function regionPath(
  fill: readonly number[],
  viewport: GraphViewport,
  area: { x: number; y: number; w: number; h: number },
): string {
  let d = '';
  for (let i = 0; i < fill.length; i += 4) {
    const topLeft = graphToScreen({ x: fill[i]!, y: fill[i + 3]! }, viewport, area);
    const bottomRight = graphToScreen({ x: fill[i + 2]!, y: fill[i + 1]! }, viewport, area);
    const left = topLeft.x.toFixed(2);
    d += `M${left} ${topLeft.y.toFixed(2)}H${bottomRight.x.toFixed(2)}V${bottomRight.y.toFixed(2)}H${left}Z`;
  }
  return d;
}

function stepFor(range: number, size: number): number {
  const targetCount = Math.max(2, Math.floor(size / 70));
  return niceStep(Math.abs(range) / targetCount);
}

const GRAPH_CARD_RADIUS = 8;
const GRAPH_SHADOW_BLUR = 6;
const GRAPH_SHADOW_DY = 4;
const GRAPH_SHADOW_OPACITY = 0.08;

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
    const detail = useLodDetail();
    const groupRef = useRef<SVGGElement>(null);
    const shapeId = shape.id;

    // While this graph is the sole selection, the wheel drives its viewport
    // instead of the board camera: ctrl/⌘+wheel (and trackpad pinch) zooms about
    // the cursor, plain wheel pans. stopPropagation keeps the canvas's own native
    // wheel listener (which moves the camera) from also firing.
    useEffect(() => {
      const el = groupRef.current;
      if (!el) return;
      let undoTimer: number | null = null;
      const writer = createGraphViewportWriter(shapeId, () => {
        if (undoTimer !== null) window.clearTimeout(undoTimer);
        undoTimer = window.setTimeout(() => {
          undoTimer = null;
          breakUndoCapture();
        }, WHEEL_UNDO_IDLE_MS);
      });
      const onWheel = (e: WheelEvent) => {
        const selected = useSelectionStore.getState().selectedIds;
        if (selected.length !== 1 || selected[0] !== shapeId) return;
        const current = editor.getShape(shapeId);
        if (!current || current.type !== 'graph') return;
        const matrix = el.getScreenCTM();
        if (!matrix) return;
        const inverse = matrix.inverse();
        const local = new DOMPoint(e.clientX, e.clientY).matrixTransform(inverse);
        // The scene renders each shape at its local origin. Its screen matrix
        // includes the camera, shape rotation, and all parent transforms.
        const area = plotArea({ x: 0, y: 0, props: current.props });
        e.preventDefault();
        e.stopPropagation();
        const wheel = normalizeWheelDelta(e);

        if (e.ctrlKey || e.metaKey) {
          const delta = clampNum(
            wheel.y,
            -WHEEL_MAX_ZOOM_DELTA,
            WHEEL_MAX_ZOOM_DELTA,
          );
          // Match the camera direction: scroll up = zoom in = smaller range.
          const factor = 1 / (1 - delta / 100);
          writer.update((viewport) =>
            zoomViewport(viewport, area, local, factor),
          );
        } else {
          const dx = inverse.a * wheel.x + inverse.c * wheel.y;
          const dy = inverse.b * wheel.x + inverse.d * wheel.y;
          writer.update((viewport) => panViewport(viewport, area, dx, dy));
        }
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', onWheel);
        // Don't strand the tail of a gesture that ended on unmount.
        writer.flush();
        if (undoTimer !== null) {
          window.clearTimeout(undoTimer);
          // The gesture is over for good, so close its undo step now rather
          // than letting the next unrelated edit join it.
          breakUndoCapture();
        }
      };
    }, [shapeId]);

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
    // Zoomed far out the card drop shadow is sub-pixel; skip it.
    const shadow = detail === 'high';
    const samples = Math.max(180, Math.round(area.w * 1.4));
    const verticalSamples = Math.max(120, Math.round(area.h * 1.4));
    const showAxisLabels = props.showAxisLabels !== false;
    const points = props.points ?? [];
    // The mathjs parser is fetched on demand; until it lands every expression
    // reads as unparsable, so each memo below has to recompute when it arrives.
    const mathReady = useGraphMathReady();
    const functionDefinitions = useMemo(
      () => createGraphFunctionDefinitions(props.expressions),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [props.expressions, mathReady],
    );

    // A slider being played sweeps its value locally rather than through the
    // document; while that is happening the live value wins.
    const animated = useGraphAnimationStore((s) => s.values[shapeId]);
    const parameters = useMemo(
      () =>
        animated
          ? mergeGraphParameters(props.parameters, animated)
          : props.parameters,
      [props.parameters, animated],
    );

    // Sampling is the expensive part of drawing a graph — a contour pass alone
    // evaluates the expression ~65k times — so it runs in a worker, along with
    // the intersection root finding.
    const { curves, intersections } = useGraphCurves(
      {
        expressions: props.expressions,
        viewport,
        parameters,
        samples,
        verticalSamples,
        intersections: props.showIntersections === true,
      },
      functionDefinitions,
      mathReady,
    );
    // Mapped once: the paths, their dash lengths and hover tracing all read it.
    const drawn = curves.map(({ expression, result }) => ({
      expression,
      result,
      screens: result.ok
        ? result.segments.map((segment) =>
            segment.map((point) => graphToScreen(point, viewport, area)),
          )
        : [],
    }));
    const xLabelsBelow = clippedXAxis <= area.y + area.h - 18;
    const xLabelY = xLabelsBelow ? clippedXAxis + 13 : clippedXAxis - 7;
    const yLabelsRight = clippedYAxis <= area.x + area.w - 34;
    const yLabelX = yLabelsRight ? clippedYAxis + 6 : clippedYAxis - 6;
    const yLabelAnchor = yLabelsRight ? 'start' : 'end';
    const axisLabelStyle = {
      fontSize: 10,
      fill: 'var(--color-muted-foreground)',
      stroke: 'var(--color-panel)',
      strokeWidth: 3,
      paintOrder: 'stroke' as const,
    };
    const intersectionLabelStyle = {
      fontSize: 13,
      fontWeight: 600 as const,
      fill: 'var(--color-foreground)',
      stroke: 'var(--color-panel)',
      strokeWidth: 3.5,
      paintOrder: 'stroke' as const,
    };

    // Tick labels paint over the plot, so point labels must steer clear of them.
    const tickLabelBoxes: LabelBox[] = [];
    if (showAxisLabels) {
      const box = (text: string, x: number, y: number, anchor: string) => {
        const w = measureTextWidth(text, axisLabelStyle.fontSize);
        const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        return { x: left, y: y - 8, w, h: 10 };
      };
      for (const x of xTicks) {
        if (x === 0) continue;
        const screen = graphToScreen({ x, y: 0 }, viewport, area);
        tickLabelBoxes.push(box(formatAxisLabel(x), screen.x, xLabelY, 'middle'));
      }
      for (const y of yTicks) {
        if (y === 0) continue;
        const screen = graphToScreen({ x: 0, y }, viewport, area);
        tickLabelBoxes.push(box(formatAxisLabel(y), yLabelX, screen.y + 4, yLabelAnchor));
      }
      tickLabelBoxes.push(box('0', yLabelX, xLabelY, yLabelAnchor));
    }
    const intersectionMarks = intersections.map((point) => ({
      screen: graphToScreen(point, viewport, area),
      text: formatIntersectionLabel(point),
    }));
    // Crowded points keep their dot and drop the label to a hover tooltip.
    const intersectionLabels = placePointLabels(
      intersectionMarks.map(({ screen, text }) => ({
        x: screen.x,
        y: screen.y,
        width: measureTextWidth(
          text,
          intersectionLabelStyle.fontSize,
          'sans',
          intersectionLabelStyle.fontWeight,
        ),
      })),
      area,
      {
        fontSize: intersectionLabelStyle.fontSize,
        dotRadius: 7,
        offset: 8,
        obstacles: tickLabelBoxes,
      },
    );

    return (
      <g
        ref={groupRef}
        style={{ pointerEvents: 'auto' }}
        transform={rotationTransform(shape.x, shape.y, props.w, props.h, shape.rotation)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={4} />
          </clipPath>
        </defs>

        {shadow && (
          <PaintedShadow
            d={roundedRectPath(
              shape.x,
              shape.y,
              props.w,
              props.h,
              GRAPH_CARD_RADIUS,
            )}
            dy={GRAPH_SHADOW_DY}
            blur={GRAPH_SHADOW_BLUR}
            opacity={GRAPH_SHADOW_OPACITY}
          />
        )}
        <rect
          x={shape.x}
          y={shape.y}
          width={props.w}
          height={props.h}
          rx={GRAPH_CARD_RADIUS}
          fill="var(--color-card)"
          stroke="var(--color-border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />

        <rect
          x={area.x}
          y={area.y}
          width={area.w}
          height={area.h}
          rx={4}
          fill="var(--color-panel)"
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
          {drawn.map(({ expression, result, screens }) => {
            if (!result.ok) return null;
            const width = expression.width ?? DEFAULT_GRAPH_CURVE_WIDTH;
            // A strict inequality's boundary isn't in its region: dashed,
            // unless the row already asks for a pattern of its own.
            const dash =
              result.strict && (expression.dash ?? 'solid') === 'solid'
                ? 'dashed'
                : expression.dash;
            return (
              <g key={expression.id}>
                {result.fill?.length ? (
                  <path
                    d={regionPath(result.fill, viewport, area)}
                    fill={expression.color}
                    fillOpacity={0.2}
                  />
                ) : null}
                {screens.map((screen, index) => {
                  return (
                    <path
                      key={`${expression.id}-${index}`}
                      d={pathFromPoints(screen)}
                      fill="none"
                      stroke={expression.color}
                      strokeWidth={width}
                      strokeLinecap={strokeLineCap(dash) ?? 'round'}
                      strokeLinejoin="round"
                      {...dashProps(dash, width, polylineLength(screen))}
                      vectorEffect="non-scaling-stroke"
                    />
                  );
                })}
                {result.points?.map((point, index) => {
                  const screen = graphToScreen(point, viewport, area);
                  return (
                    <circle
                      key={`${expression.id}-point-${index}`}
                      cx={screen.x}
                      cy={screen.y}
                      r={5}
                      fill={expression.color}
                      stroke="var(--color-panel)"
                      strokeWidth={1.75}
                    />
                  );
                })}
              </g>
            );
          })}
          {/* Points from the retired points list; new ones are `(x, y)` expressions. */}
          {points.map((point) => {
            if (!point.visible) return null;
            const screen = graphToScreen(point, viewport, area);
            return (
              <circle
                key={point.id}
                cx={screen.x}
                cy={screen.y}
                r={5}
                fill={point.color}
                stroke="var(--color-panel)"
                strokeWidth={1.75}
              />
            );
          })}
          {intersectionMarks.map(({ screen, text }, index) => {
            const label = intersectionLabels[index];
            return (
              <g key={`ix-${index}`}>
                <circle
                  cx={screen.x}
                  cy={screen.y}
                  r={5}
                  fill="var(--color-foreground)"
                  stroke="var(--color-panel)"
                  strokeWidth={1.75}
                >
                  {label ? null : <title>{text}</title>}
                </circle>
                {label ? (
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    {...intersectionLabelStyle}
                  >
                    {text}
                  </text>
                ) : null}
              </g>
            );
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
          <GraphTrace
            target={groupRef}
            curves={drawn.map(({ expression, screens }) => ({
              color: expression.color,
              screens,
            }))}
            viewport={viewport}
            area={area}
          />
        </g>
      </g>
    );
  },
};

export const GRAPH_DEFAULT_SIZE = { w: DEFAULT_W, h: DEFAULT_H };
