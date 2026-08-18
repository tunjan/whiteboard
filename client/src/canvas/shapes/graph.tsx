import { useEffect, useMemo, useRef } from 'react';
import type { GraphViewport } from '@whiteboard/shared';
import { screenToWorld } from '../camera';
import { formatAxisLabel, niceStep, tickValues } from '../grid';
import {
  DEFAULT_GRAPH_CURVE_WIDTH,
  createDefaultGraphProps,
} from '../graph-defaults';
import { mergeGraphParameters } from '../graph-parameters';
import { createGraphFunctionDefinitions } from '../graph-parser';
import { sampleGraphExpression } from '../graph-sampler';
import { useGraphAnimationStore } from '../use-graph-animation-store';
import {
  findGraphIntersections,
  formatIntersectionLabel,
} from '../graph-intersections';
import { useLodDetail } from '../lod';
import { useCameraStore } from '../use-camera-store';
import { breakUndoCapture, editor } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { graphToScreen, panViewport, zoomViewport } from './graph-interaction';
import { polylineLength } from './perfect-dash';
import { dashProps, strokeLineCap } from './render-style';
import type { ShapeUtil } from './types';

const DEFAULT_W = 420;
const DEFAULT_H = 280;
const MIN_W = 220;
const MIN_H = 160;
const PLOT_PADDING = 16;
// Wheel-zoom feel, mirrored from the board camera (use-wheel.ts).
const WHEEL_LINE_HEIGHT = 16;
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
      // Wheel events outrun frames — a trackpad emits well over 100 a second,
      // and each one written straight through is a shape update the CRDT keeps
      // and every peer receives. Gestures accumulate here and commit once per
      // frame instead.
      let pendingViewport: GraphViewport | null = null;
      let commitFrame = 0;
      const commit = () => {
        commitFrame = 0;
        if (!pendingViewport) return;
        editor.updateShape(shapeId, { props: { viewport: pendingViewport } });
        pendingViewport = null;
        if (undoTimer !== null) window.clearTimeout(undoTimer);
        undoTimer = window.setTimeout(() => {
          undoTimer = null;
          breakUndoCapture();
        }, WHEEL_UNDO_IDLE_MS);
      };
      const onWheel = (e: WheelEvent) => {
        const selected = useSelectionStore.getState().selectedIds;
        if (selected.length !== 1 || selected[0] !== shapeId) return;
        const current = editor.getShape(shapeId);
        if (!current || current.type !== 'graph') return;
        e.preventDefault();
        e.stopPropagation();

        const camera = useCameraStore.getState().camera;
        const rect = el.ownerSVGElement?.getBoundingClientRect();
        const screen = {
          x: e.clientX - (rect?.left ?? 0),
          y: e.clientY - (rect?.top ?? 0),
        };
        const world = screenToWorld(screen, camera);
        const area = plotArea(current);
        // Build on the uncommitted viewport so events within one frame compose.
        const viewport = pendingViewport ?? current.props.viewport;

        let next: GraphViewport;
        if (e.ctrlKey || e.metaKey) {
          const lineScale = e.deltaMode === 1 ? WHEEL_LINE_HEIGHT : 1;
          const delta = clampNum(
            e.deltaY * lineScale,
            -WHEEL_MAX_ZOOM_DELTA,
            WHEEL_MAX_ZOOM_DELTA,
          );
          // Match the camera direction: scroll up = zoom in = smaller range.
          const factor = 1 / (1 - delta / 100);
          next = zoomViewport(viewport, area, world, factor);
        } else {
          const scale = (e.deltaMode === 1 ? WHEEL_LINE_HEIGHT : 1) / camera.z;
          next = panViewport(viewport, area, e.deltaX * scale, e.deltaY * scale);
        }

        pendingViewport = next;
        if (!commitFrame) commitFrame = requestAnimationFrame(commit);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => {
        el.removeEventListener('wheel', onWheel);
        if (commitFrame) cancelAnimationFrame(commitFrame);
        // Don't strand the tail of a gesture that ended on unmount.
        commit();
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
    const shadowId = `graph-shadow-${safeId(shape.id)}`;
    // Zoomed far out the card drop shadow is sub-pixel; skip it (and its filter).
    const shadow = detail === 'high';
    const samples = Math.max(180, Math.round(area.w * 1.4));
    const verticalSamples = Math.max(120, Math.round(area.h * 1.4));
    const showAxisLabels = props.showAxisLabels !== false;
    const points = props.points ?? [];
    const functionDefinitions = useMemo(
      () => createGraphFunctionDefinitions(props.expressions),
      [props.expressions],
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
    // evaluates the expression ~65k times. Every one of these inputs changes the
    // curve; anything else that re-renders this component (a selection change, a
    // theme flip, a parent re-render) reuses the result.
    const curves = useMemo(
      () =>
        props.expressions.map((expression) => ({
          expression,
          result: sampleGraphExpression(
            expression,
            viewport,
            parameters,
            samples,
            verticalSamples,
            functionDefinitions,
          ),
        })),
      [
        props.expressions,
        viewport,
        parameters,
        samples,
        verticalSamples,
        functionDefinitions,
      ],
    );

    const intersections = useMemo(
      () =>
        props.showIntersections === true
          ? findGraphIntersections(
              props.expressions,
              viewport,
              parameters,
              240,
              functionDefinitions,
            )
          : [],
      [
        props.showIntersections,
        props.expressions,
        viewport,
        parameters,
        functionDefinitions,
      ],
    );
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
      fontWeight: 600,
      fill: 'var(--color-foreground)',
      stroke: 'var(--color-panel)',
      strokeWidth: 3.5,
      paintOrder: 'stroke' as const,
    };

    return (
      <g
        ref={groupRef}
        transform={rotationTransform(shape.x, shape.y, props.w, props.h, shape.rotation)}
      >
        <defs>
          {shadow && (
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
          )}
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
          filter={shadow ? `url(#${shadowId})` : undefined}
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
          {curves.map(({ expression, result }) => {
            if (!result.ok) return null;
            const width = expression.width ?? DEFAULT_GRAPH_CURVE_WIDTH;
            return (
              <g key={expression.id}>
                {result.segments.map((segment, index) => (
                  <path
                    key={`${expression.id}-${index}`}
                    d={pathFromSegment(segment, viewport, area)}
                    fill="none"
                    stroke={expression.color}
                    strokeWidth={width}
                    strokeLinecap={strokeLineCap(expression.dash) ?? 'round'}
                    strokeLinejoin="round"
                    {...dashProps(
                      expression.dash,
                      width,
                      polylineLength(
                        segment.map((point) =>
                          graphToScreen(point, viewport, area),
                        ),
                      ),
                    )}
                    vectorEffect="non-scaling-stroke"
                  />
                ))}
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
          {intersections.map((point, index) => {
            const screen = graphToScreen(point, viewport, area);
            const nearRight = screen.x > area.x + area.w - 64;
            const nearTop = screen.y < area.y + 16;
            return (
              <g key={`ix-${index}`}>
                <circle
                  cx={screen.x}
                  cy={screen.y}
                  r={5}
                  fill="var(--color-foreground)"
                  stroke="var(--color-panel)"
                  strokeWidth={1.75}
                />
                <text
                  x={nearRight ? screen.x - 8 : screen.x + 8}
                  y={nearTop ? screen.y + 18 : screen.y - 8}
                  textAnchor={nearRight ? 'end' : 'start'}
                  {...intersectionLabelStyle}
                >
                  {formatIntersectionLabel(point)}
                </text>
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
        </g>
      </g>
    );
  },
};

export const GRAPH_DEFAULT_SIZE = { w: DEFAULT_W, h: DEFAULT_H };
