import { useMemo, useRef } from 'react';
import type { Graph3dView, GraphExpression, GraphShape } from '@whiteboard/shared';
import { DEFAULT_GRAPH_CURVE_WIDTH } from '../graph-defaults';
import { useGraphMathReady } from '../graph-math';
import { mergeGraphParameters } from '../graph-parameters';
import { createGraphFunctionDefinitions } from '../graph-parser';
import {
  axisLabels3d,
  buildScene3d,
  createProjection,
  orbitView,
  projectScene,
  tone,
  zoomGraph3d,
  type Placed3,
  type ScreenPoint,
} from '../graph3d';
import { useLodDetail } from '../lod';
import { useGraphAnimationStore } from '../use-graph-animation-store';
import { GraphCard, plotArea } from './graph-card';
import { polylineLength } from './perfect-dash';
import { dashProps, strokeLineCap } from './render-style';
import { useGraphWheel } from './use-graph-wheel';

/** A surface is near-opaque; a plane is see-through, so what it cuts shows. */
const SURFACE_OPACITY = 0.85;
const PLANE_OPACITY = 0.45;

const TICK_LABEL_STYLE = {
  fontSize: 10,
  fill: 'var(--color-muted-foreground)',
  stroke: 'var(--color-panel)',
  strokeWidth: 2,
  paintOrder: 'stroke' as const,
  textAnchor: 'middle' as const,
  dominantBaseline: 'middle' as const,
  style: { fontVariantNumeric: 'tabular-nums' },
};

const AXIS_NAME_STYLE = {
  fontSize: 13,
  fontStyle: 'italic',
  fontFamily: "'KaTeX_Math', 'KaTeX_Main', serif",
  fill: 'var(--color-muted-foreground)',
  textAnchor: 'middle' as const,
  dominantBaseline: 'middle' as const,
};

function safeId(id: string): string {
  return id.replace(/[^A-Za-z0-9_-]/g, '-');
}

function pathOf(points: readonly ScreenPoint[], closed: boolean): string {
  let d = '';
  for (let i = 0; i < points.length; i += 1) {
    d += `${i === 0 ? 'M' : 'L'}${points[i]!.x.toFixed(2)} ${points[i]!.y.toFixed(2)}`;
  }
  return closed ? `${d}Z` : d;
}

/**
 * Everything placed, as SVG, far to near. One node per item: merging alike
 * neighbours into shared paths was tried and measured 5× slower, since the
 * number of merged paths changes every frame of a turn and the index-keyed
 * nodes then churn.
 */
function drawPlaced(placed: readonly Placed3[], expressions: readonly GraphExpression[]) {
  // Index keys on purpose: the depth order changes as the box turns, and
  // updating nodes in place is cheaper than moving them.
  return placed.map((item, index) => {
    if (item.kind === 'run' && typeof item.source !== 'number') {
      const axis = item.source === 'axis';
      return (
        <path
          key={index}
          d={pathOf(item.points, false)}
          fill="none"
          stroke={axis ? 'var(--grid-axis)' : 'var(--grid-major)'}
          strokeWidth={axis ? 1.25 : 1}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      );
    }
    const expression = expressions[item.source as number];
    if (!expression) return null;
    const color = expression.color;
    switch (item.kind) {
      case 'face':
        return (
          <path
            key={index}
            d={pathOf(item.points, true)}
            fill={tone(color, item.light)}
            fillOpacity={item.plane ? PLANE_OPACITY : SURFACE_OPACITY}
            // The mesh: it shows the shape's curvature and closes the hairline
            // seams anti-aliasing leaves between neighbouring facets.
            stroke={tone(color, 0)}
            strokeOpacity={0.35}
            strokeWidth={0.5}
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        );
      case 'run': {
        const width = expression.width ?? DEFAULT_GRAPH_CURVE_WIDTH;
        // Each run is dashed whole, so neighbouring runs meet on a dash.
        return (
          <path
            key={index}
            d={pathOf(item.points, false)}
            fill="none"
            stroke={color}
            strokeWidth={width}
            strokeLinecap={strokeLineCap(expression.dash) ?? 'round'}
            strokeLinejoin="round"
            {...dashProps(expression.dash, width, polylineLength(item.points))}
            vectorEffect="non-scaling-stroke"
          />
        );
      }
      case 'dot':
        return (
          <circle
            key={index}
            cx={item.point.x}
            cy={item.point.y}
            r={5}
            fill={color}
            stroke="var(--color-panel)"
            strokeWidth={1.75}
          />
        );
    }
  });
}

/**
 * A graph in three dimensions: everything its rows draw, inside a box that
 * turns with a drag (see the select tool's orbit) or the wheel.
 */
export function Graph3dPlot({ shape, view }: { shape: GraphShape; view: Graph3dView }) {
  const props = shape.props;
  const shapeId = shape.id;
  const groupRef = useRef<SVGGElement>(null);

  // Sole-selected, a plain wheel (a two-finger swipe) turns the box, the
  // content following the fingers; ctrl/⌘+wheel or a pinch zooms all three
  // ranges about their middles.
  useGraphWheel(groupRef, shapeId, ({ delta, zoom, writer }) => {
    writer.update3d(({ viewport, view3d }) =>
      zoom !== null
        ? zoomGraph3d(viewport, view3d, zoom)
        : { viewport, view3d: orbitView(view3d, -delta.x, -delta.y) },
    );
  });

  const area = plotArea(shape);
  const angleUnit = props.angleUnit ?? 'rad';
  const detail = useLodDetail();
  // The parser is fetched on demand; until it lands every row reads as
  // unparsable, so the scene has to be rebuilt when it arrives.
  const mathReady = useGraphMathReady();
  const definitions = useMemo(
    () => createGraphFunctionDefinitions(props.expressions, angleUnit),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.expressions, angleUnit, mathReady],
  );
  // A slider being played sweeps its value locally; the live value wins.
  const animated = useGraphAnimationStore((s) => s.values[shapeId]);
  const parameters = useMemo(
    () => (animated ? mergeGraphParameters(props.parameters, animated) : props.parameters),
    [props.parameters, animated],
  );

  const { xMin, xMax, yMin, yMax } = props.viewport;
  const { zMin, zMax } = view;
  const box = useMemo(
    () => ({ min: { x: xMin, y: yMin, z: zMin }, max: { x: xMax, y: yMax, z: zMax } }),
    [xMin, xMax, yMin, yMax, zMin, zMax],
  );
  // Sampled once per change of rows, sliders or ranges. Turning the box only
  // re-projects it, below.
  const scene = useMemo(
    () =>
      buildScene3d({
        expressions: props.expressions,
        parameters,
        definitions,
        box,
        angleUnit,
        detail,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.expressions, parameters, definitions, box, angleUnit, detail, mathReady],
  );

  const projection = createProjection(box, view, area);
  const placed = projectScene(scene, projection, box);
  const labels = axisLabels3d(box, projection);
  const showNumbers = props.showAxisLabels !== false;
  const clipId = `graph3d-clip-${safeId(shapeId)}`;

  return (
    <GraphCard shape={shape} ref={groupRef}>
      <defs>
        <clipPath id={clipId}>
          <rect x={area.x} y={area.y} width={area.w} height={area.h} rx={4} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        {drawPlaced(placed, props.expressions)}
        <g style={{ pointerEvents: 'none', userSelect: 'none' }}>
          {labels.map(({ axis, ticks, name }) => (
            <g key={axis}>
              {showNumbers
                ? ticks.map((tick) => (
                    <text key={`${axis}-${tick.text}`} x={tick.x} y={tick.y} {...TICK_LABEL_STYLE}>
                      {tick.text}
                    </text>
                  ))
                : null}
              <text x={name.x} y={name.y} {...AXIS_NAME_STYLE}>
                {axis}
              </text>
            </g>
          ))}
        </g>
      </g>
    </GraphCard>
  );
}
