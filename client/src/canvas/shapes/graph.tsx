import { useEffect, useMemo, useRef } from 'react';
import type { GraphViewport } from '@whiteboard/shared';
import {
  DEFAULT_GRAPH_CURVE_WIDTH,
  createDefaultGraphProps,
} from '../graph-defaults';
import { useGraphMathReady } from '../graph-math';
import { mergeGraphParameters } from '../graph-parameters';
import { createGraphFunctionDefinitions } from '../graph-parser';
import { useGraphCurves } from '../graph-sample-client';
import { useGraphAnimationStore } from '../use-graph-animation-store';
import { formatIntersectionCoordinate } from '../graph-intersections';
import { fitViewport, fromPlot, graphAxes, isLinear, toPlot, toPlotViewport } from '../graph-scale';
import { axisTicks, exactPi, plotsTrig, type TickStyle } from '../graph-ticks';
import { placePointLabels, touchesLine, type LabelBox } from '../graph-label-layout';
import { useLodDetail } from '../lod';
import { normalizeWheelDelta } from '../use-wheel';
import { breakUndoCapture, editor } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { graphToScreen, panViewport, zoomViewport } from './graph-interaction';
import { GraphTrace, POINT_LABEL_STYLE } from './graph-trace';
import { createGraphViewportWriter } from './graph-viewport-writer';
import { PaintedShadow, roundedRectPath } from './painted-shadow';
import { polylineLength } from './perfect-dash';
import { dashProps, strokeLineCap } from './render-style';
import { measureTextWidth } from './text-measure';
import type { ShapeUtil } from './types';

const DEFAULT_W = 400;
const DEFAULT_H = 400;
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
    const axes = graphAxes(props);
    const angleUnit = props.angleUnit ?? 'rad';
    // A peer's log switch can land before its window does; draw a fitting one.
    const dataViewport = fitViewport(props.viewport, axes);
    // Everything below is drawn in plot space, where a log axis is linear.
    const viewport = toPlotViewport(dataViewport, axes);
    const xStyle: TickStyle =
      axes.x === 'log'
        ? 'log'
        : plotsTrig(props.expressions)
          ? angleUnit === 'deg'
            ? 'degrees'
            : 'pi'
          : 'linear';
    const xTicks = axisTicks(dataViewport.xMin, dataViewport.xMax, area.w, xStyle);
    const yTicks = axisTicks(
      dataViewport.yMin,
      dataViewport.yMax,
      area.h,
      axes.y === 'log' ? 'log' : 'linear',
    );
    // A log axis has no zero: its partner axis rides the plot's edge.
    const origin = graphToScreen(toPlot({ x: 0, y: 0 }, axes), viewport, area);
    const clippedXAxis = Math.max(area.y, Math.min(area.y + area.h, origin.y));
    const clippedYAxis = Math.max(area.x, Math.min(area.x + area.w, origin.x));
    const originVisible =
      isLinear(axes) && clippedXAxis === origin.y && clippedYAxis === origin.x;
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
      () => createGraphFunctionDefinitions(props.expressions, angleUnit),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [props.expressions, angleUnit, mathReady],
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
        viewport: dataViewport,
        parameters,
        samples,
        verticalSamples,
        intersections: props.showIntersections === true,
        ...(isLinear(axes) ? {} : { axes }),
        ...(angleUnit === 'deg' ? { angleUnit } : {}),
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
    // A plot-space point as the reader wants it: back in data units, on a
    // trig plot in degrees with its degree sign.
    const formatPoint = (point: { x: number; y: number }) => {
      const value = fromPlot(point, axes);
      // On a π axis, `−5π/2` rather than the −7.85 no tick would match.
      const x =
        (xStyle === 'pi' ? exactPi(value.x) : null) ??
        formatIntersectionCoordinate(value.x, axes.x);
      const y = formatIntersectionCoordinate(value.y, axes.y);
      return `(${x}${xStyle === 'degrees' ? '°' : ''}, ${y})`;
    };
    const xLabelsBelow = clippedXAxis <= area.y + area.h - 18;
    const xLabelY = xLabelsBelow ? clippedXAxis + 13 : clippedXAxis - 7;
    const yLabelsRight = clippedYAxis <= area.x + area.w - 34;
    const yLabelX = yLabelsRight ? clippedYAxis + 6 : clippedYAxis - 6;
    const yLabelAnchor = yLabelsRight ? 'start' : 'end';
    const axisLabelStyle = {
      fontSize: 10,
      fill: 'var(--color-muted-foreground)',
      stroke: 'var(--color-panel)',
      strokeWidth: 2,
      paintOrder: 'stroke' as const,
      style: { fontVariantNumeric: 'tabular-nums' },
    };

    // Tick labels, placed once: drawn below, and steered clear of by point
    // labels. One the plot edge would cut in half is dropped, not clipped.
    const tickLabelBoxes: LabelBox[] = [];
    const xLabels: { key: string; x: number; shift: number; text: string }[] = [];
    const yLabels: { key: string; y: number; shift: number; text: string }[] = [];
    if (showAxisLabels) {
      // A curve through a number strikes it out: the number slides just off
      // the curve, staying beside its tick. With no clear side it stays put.
      const curveLines = drawn.flatMap(({ screens }) => screens);
      const clearShift = (b: LabelBox, axis: 'x' | 'y', step: number) =>
        [0, -step, step].find(
          (shift) =>
            !curveLines.some((line) =>
              touchesLine({ ...b, [axis]: b[axis] + shift }, line),
            ),
        ) ?? 0;
      const box = (text: string, x: number, y: number, anchor: string) => {
        const w = measureTextWidth(text, axisLabelStyle.fontSize);
        const left = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
        return { x: left, y: y - 8, w, h: 10 };
      };
      for (const { at, label } of xTicks.major) {
        // The origin writes its own single 0.
        if (label === null || (originVisible && at === 0)) continue;
        const x = graphToScreen({ x: at, y: 0 }, viewport, area).x;
        const b = box(label, x, xLabelY, 'middle');
        const shift = clearShift(b, 'x', b.w / 2 + 3);
        const left = b.x + shift;
        if (left < area.x + 2 || left + b.w > area.x + area.w - 2) continue;
        tickLabelBoxes.push({ ...b, x: left });
        xLabels.push({ key: `x-label-${at}`, x, shift, text: label });
      }
      for (const { at, label } of yTicks.major) {
        if (label === null || (originVisible && at === 0)) continue;
        const y = graphToScreen({ x: 0, y: at }, viewport, area).y;
        if (y - 6 < area.y || y + 6 > area.y + area.h) continue;
        const b = box(label, yLabelX, y + 4, yLabelAnchor);
        const shift = clearShift(b, 'y', 9);
        tickLabelBoxes.push({ ...b, y: b.y + shift });
        yLabels.push({ key: `y-label-${at}`, y, shift, text: label });
      }
      if (originVisible) tickLabelBoxes.push(box('0', yLabelX, xLabelY, yLabelAnchor));
    }
    // A point sitting on an axis, at a number that axis already prints, has
    // nothing to add: the tick beside it says the same thing.
    const printedByAxis = ({ x, y }: { x: number; y: number }) =>
      (Math.abs(y - clippedXAxis) < 0.5 &&
        xLabels.some((label) => Math.abs(label.x - x) < 0.5)) ||
      (Math.abs(x - clippedYAxis) < 0.5 &&
        yLabels.some((label) => Math.abs(label.y - y) < 0.5)) ||
      (showAxisLabels &&
        originVisible &&
        Math.hypot(x - clippedYAxis, y - clippedXAxis) < 0.5);
    const intersectionMarks = intersections.map((point) => ({
      screen: graphToScreen(point, viewport, area),
      text: formatPoint(point),
    }));
    // Only what stands clear gets text: a label never sits on a curve, an axis
    // or another label. The rest read out on hover, through the trace.
    const intersectionLabels = placePointLabels(
      intersectionMarks.map(({ screen, text }) => ({
        x: screen.x,
        y: screen.y,
        silent: printedByAxis(screen),
        width: measureTextWidth(
          text,
          POINT_LABEL_STYLE.fontSize,
          'sans',
          POINT_LABEL_STYLE.fontWeight,
        ),
      })),
      area,
      {
        fontSize: POINT_LABEL_STYLE.fontSize,
        dotRadius: 5,
        offset: 7,
        obstacles: tickLabelBoxes,
        lines: [
          ...drawn.flatMap(({ screens }) => screens),
          [
            { x: area.x, y: clippedXAxis },
            { x: area.x + area.w, y: clippedXAxis },
          ],
          [
            { x: clippedYAxis, y: area.y },
            { x: clippedYAxis, y: area.y + area.h },
          ],
        ],
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
          {/* Graph paper: faint subdivisions under the numbered lines. */}
          {[
            ...xTicks.minor.map((at) => ['x', at, 'minor'] as const),
            ...yTicks.minor.map((at) => ['y', at, 'minor'] as const),
            ...xTicks.major.map(({ at }) => ['x', at, 'major'] as const),
            ...yTicks.major.map(({ at }) => ['y', at, 'major'] as const),
          ].map(([axis, at, weight]) => {
            const screen = graphToScreen({ x: at, y: at }, viewport, area);
            const vertical = axis === 'x';
            return (
              <line
                key={`${axis}-${weight}-${at}`}
                x1={vertical ? screen.x : area.x}
                y1={vertical ? area.y : screen.y}
                x2={vertical ? screen.x : area.x + area.w}
                y2={vertical ? area.y + area.h : screen.y}
                stroke={weight === 'major' ? 'var(--grid-major)' : 'var(--grid-minor)'}
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
            const screen = graphToScreen(toPlot(point, axes), viewport, area);
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
                  r={3.5}
                  fill="var(--color-foreground)"
                  stroke="var(--color-panel)"
                  strokeWidth={1.5}
                />
                {label ? (
                  <text
                    x={label.x}
                    y={label.y}
                    textAnchor={label.anchor}
                    {...POINT_LABEL_STYLE}
                  >
                    {text}
                  </text>
                ) : null}
              </g>
            );
          })}
          {xLabels.map(({ key, x, shift, text }) => (
            <text key={key} x={x + shift} y={xLabelY} textAnchor="middle" {...axisLabelStyle}>
              {text}
            </text>
          ))}
          {yLabels.map(({ key, y, shift, text }) => (
            <text
              key={key}
              x={yLabelX}
              y={y + shift}
              textAnchor={yLabelAnchor}
              dominantBaseline="middle"
              {...axisLabelStyle}
            >
              {text}
            </text>
          ))}
          {showAxisLabels && originVisible ? (
            <text x={yLabelX} y={xLabelY} textAnchor={yLabelAnchor} {...axisLabelStyle}>
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
            axisLines={{ x: clippedXAxis, y: clippedYAxis }}
            format={formatPoint}
            marks={intersectionMarks.map(({ screen }, index) => ({
              ...screen,
              labelled: intersectionLabels[index] !== null,
            }))}
          />
        </g>
        {/* Like a calculator's DEG: whoever reads the board can't see the
            panel, and sin(90) means something else in radians. */}
        {angleUnit === 'deg' ? (
          <text
            x={shape.x + props.w - PLOT_PADDING}
            y={shape.y + PLOT_PADDING - 4.5}
            textAnchor="end"
            fontSize={8.5}
            fontWeight={600}
            letterSpacing="0.08em"
            fill="var(--color-muted-foreground)"
            style={{ pointerEvents: 'none', userSelect: 'none' }}
          >
            DEG
          </text>
        ) : null}
      </g>
    );
  },
};

export const GRAPH_DEFAULT_SIZE = { w: DEFAULT_W, h: DEFAULT_H };
