import {
  distance,
  distanceToSegment,
  pointsBounds,
  rotatePoint,
  type DrawProps,
  type Point,
} from '@whiteboard/shared';
import { DEFAULT_SHAPE_STYLE, DEFAULT_INK_SIZE } from './style';
import {
  DEFAULT_PENCIL_DYNAMICS,
  getInkCenterlinePath,
  getInkPathData,
} from './ink';
import { buildInkCenterline, type InkCenterline } from './ink-engine';
import { fillFor, strokeDashArray } from './render-style';
import { useDotLength } from '../lod';
import { useStrokePredictionStore } from '../use-stroke-prediction-store';
import type { ShapeUtil } from './types';

/** Whether a stroke encloses a region that should be painted and clickable. */
function isFilled(props: DrawProps): boolean {
  return (
    props.isClosed &&
    props.fillStyle !== undefined &&
    props.fillStyle !== 'none'
  );
}

/**
 * Even-odd containment against the conditioned centerline, treated as closed.
 *
 * Runs directly on the engine's typed arrays rather than through
 * `pointInPolygon`, which would need a `Point[]` built for it on every hover
 * sample of every closed stroke under the cursor.
 */
function centerlineContains(line: InkCenterline, p: Point): boolean {
  let inside = false;
  for (let i = 0, j = line.count - 1; i < line.count; j = i++) {
    const yi = line.y[i]!;
    const yj = line.y[j]!;
    if (yi > p.y === yj > p.y) continue;
    const xi = line.x[i]!;
    if (p.x < xi + ((line.x[j]! - xi) * (p.y - yi)) / (yj - yi)) {
      inside = !inside;
    }
  }
  return inside;
}

export const drawUtil: ShapeUtil<'draw'> = {
  type: 'draw',
  canResize: true,
  canSnap: false,

  getDefaultProps: () => ({
    points: [],
    isClosed: false,
    color: DEFAULT_SHAPE_STYLE.color,
    size: DEFAULT_INK_SIZE,
    dash: 'solid',
    fillStyle: 'none',
    ...DEFAULT_PENCIL_DYNAMICS,
  }),

  getBounds: (s) => {
    const b = pointsBounds(s.props.points);
    // Negative thinning can expand a low-pressure stroke to the full brush
    // width, so reserve that largest possible radius for indexing/culling.
    const pad = s.props.thinning !== undefined && s.props.thinning < 0
      ? s.props.size
      : s.props.size / 2;
    return {
      minX: s.x + b.minX - pad,
      minY: s.y + b.minY - pad,
      maxX: s.x + b.maxX + pad,
      maxY: s.y + b.maxY + pad,
    };
  },

  hitTest: (s, p, tol) => {
    const pts = s.props.points;
    if (pts.length === 0) return false;
    // Un-rotate the query point into the shape's local frame.
    const b = pointsBounds(pts);
    const center = { x: s.x + (b.minX + b.maxX) / 2, y: s.y + (b.minY + b.maxY) / 2 };
    const wp = s.rotation ? rotatePoint(p, center, -s.rotation) : p;
    const local = { x: wp.x - s.x, y: wp.y - s.y };

    const radius =
      s.props.thinning !== undefined && s.props.thinning < 0
        ? s.props.size
        : s.props.size / 2;
    const r = tol + radius;
    if (pts.length === 1) return distance(local, pts[0]!) <= r;
    // Test against the engine's own conditioned centerline, not the raw
    // samples: at high stabilization the rendered outline can sit several
    // pixels off the raw polyline, so hits must follow what the user sees.
    // 0.5 matches getInkPathData's fallback for legacy strokes without props.
    const line = buildInkCenterline(
      pts,
      s.props.size,
      s.props.streamline ?? 0.5,
      true,
    );
    if (line.count === 0) return false;
    const segStart = { x: line.x[0]!, y: line.y[0]! };
    if (line.count === 1) return distance(local, segStart) <= r;
    const segEnd = { x: 0, y: 0 };
    for (let i = 1; i < line.count; i++) {
      segEnd.x = line.x[i]!;
      segEnd.y = line.y[i]!;
      if (distanceToSegment(local, segStart, segEnd) <= r) return true;
      segStart.x = segEnd.x;
      segStart.y = segEnd.y;
    }
    // A closed stroke with a fill is an area, so its interior is clickable too
    // — the same rule the box shapes follow. Unfilled, only the ink itself is.
    if (isFilled(s.props)) return centerlineContains(line, local);
    return false;
  },

  resize: (initial, nb) => {
    const pad = initial.props.size / 2;
    const pb0 = pointsBounds(initial.props.points);
    const iw = pb0.maxX - pb0.minX + 2 * pad || 1;
    const ih = pb0.maxY - pb0.minY + 2 * pad || 1;
    const sx = (nb.maxX - nb.minX) / iw;
    const sy = (nb.maxY - nb.minY) / ih;
    const points = initial.props.points.map((p) => ({
      ...p,
      x: p.x * sx,
      y: p.y * sy,
    }));
    const pb = pointsBounds(points);
    return {
      x: nb.minX - (pb.minX - pad),
      y: nb.minY - (pb.minY - pad),
      props: { ...initial.props, points },
    };
  },

  Component: ({ shape }) => {
    const {
      points,
      color,
      size,
      dash,
      fillStyle,
      simulatePressure,
      thinning,
      smoothing,
      streamline,
      startTaper,
      endTaper,
    } = shape.props;
    // A dot is a zero-length dash, which browsers drop once the stroke is
    // sub-pixel wide — the dotted pencil vanished entirely when zoomed out.
    const dotLength = useDotLength();
    // Predicted tail of the locally in-progress stroke (empty for everyone
    // else's shapes). Render-only: extends the visible ink toward the
    // browser's predicted pointer position without touching the document.
    const predictedTail = useStrokePredictionStore((store) =>
      store.shapeId === shape.id ? store.points : null,
    );
    if (points.length === 0) return null;
    const renderPoints =
      predictedTail && predictedTail.length > 0
        ? points.concat(predictedTail)
        : points;
    const b = pointsBounds(points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rotate = shape.rotation
      ? ` rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy})`
      : '';
    const transform = `translate(${shape.x} ${shape.y})${rotate}`;

    // Dashed/dotted ink strokes a uniform-width centerline (like lines and
    // polygons); solid keeps the variable-width freehand-engine fill.
    const ink =
      dash && dash !== 'solid' && renderPoints.length >= 2 ? (
        <path
          d={getInkCenterlinePath(renderPoints, size, streamline)}
          fill="none"
          stroke={color}
          strokeWidth={size}
          strokeDasharray={strokeDashArray(dash, size, dotLength)}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={transform}
        />
      ) : (
        <path
          d={getInkPathData(renderPoints, size, true, {
            simulatePressure,
            thinning,
            smoothing,
            streamline,
            startTaper,
            endTaper,
          })}
          fill={color}
          transform={transform}
        />
      );

    if (!isFilled(shape.props)) return ink;
    // Painted from the centerline closed back on itself, so the fill meets the
    // ink's inner edge rather than its outer one. Only closed strokes reach
    // here, so that seam is the gap the hand left, not an arbitrary chord.
    const f = fillFor(shape.id, color, fillStyle!);
    return (
      <>
        {f.pattern ? <defs>{f.pattern}</defs> : null}
        <path
          d={`${getInkCenterlinePath(renderPoints, size, streamline)} Z`}
          fill={f.fill}
          fillOpacity={f.fillOpacity}
          stroke="none"
          transform={transform}
        />
        {ink}
      </>
    );
  },
};
