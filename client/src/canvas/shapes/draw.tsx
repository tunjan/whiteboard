import {
  distance,
  distanceToSegment,
  pointsBounds,
  rotatePoint,
  type DrawPoint,
  type DrawProps,
  type Point,
} from '@whiteboard/shared';
import { DEFAULT_SHAPE_STYLE, DEFAULT_INK_SIZE } from './style';
import {
  DEFAULT_PENCIL_DYNAMICS,
  EMPTY_INK_CENTERLINE,
  getInkCenterlineGeometry,
  getInkPathData,
  maxInkRadius,
} from './ink';
import { buildInkCenterline, type InkCenterline } from './ink-engine';
import { resizePolyline } from './line-geometry';
import type { DashProps } from './perfect-dash';
import { dashProps, fillFor } from './render-style';
import { useInkLod } from '../lod';
import type { ShapeUtil } from './types';
import { highlightPaint, HIGHLIGHT_UNDERLAY_OPACITY, HIGHLIGHT_OVERLAY_OPACITY } from './highlight';

/** Whether a stroke encloses a region that should be painted and clickable. */
function isFilled(props: DrawProps): boolean {
  return (
    props.isClosed &&
    props.fillStyle !== undefined &&
    props.fillStyle !== 'none'
  );
}

/**
 * Everything geometric about one rendering of an ink stroke.
 *
 * Two renderers consume this: {@link drawUtil}'s component, which draws every
 * stroke the document holds, and the active-stroke layer, which draws the one
 * the local pointer is currently making. Splitting the geometry out of the JSX
 * is what lets the second write SVG attributes directly — no React render on
 * the frame budget — without the two drifting apart on how a stroke looks.
 */
export interface InkRender {
  /**
   * True when the ink is a uniform-width centerline that gets *stroked* — as
   * dashed and dotted pencils are, and as any stroke too fine on screen to
   * show its width profile is; false when it is the variable-width outline the
   * freehand engine produces, which gets *filled*.
   */
  stroked: boolean;
  /** Path data for the ink itself. */
  d: string;
  /** Dash attributes for a stroked centerline; null when solid. */
  dash: DashProps | null;
  /** Closed centerline painting a filled stroke's interior; null when unfilled. */
  fillPath: string | null;
}

/**
 * Build the paths for one ink stroke.
 *
 * `points` is what should be drawn, so a live stroke passes its committed
 * points already concatenated with the predicted tail. `isDrawing` says the
 * stroke is still growing, which only dashes care about: their spacing is
 * distributed across a known arc length, and refitting that every frame would
 * slide every dash along the stroke as it grew.
 *
 * `forceSolid` asks for the cheap centerline instead of the freehand outline;
 * see `useForceSolidInk` for when that trade is worth making.
 *
 * `errorLimit` is how far, in world units, either path may deviate from the
 * exact one because the camera has pulled back far enough that the difference
 * is sub-pixel; see `useInkErrorLimit`.
 */
export function buildInkRender(
  props: DrawProps,
  points: DrawPoint[],
  isDrawing: boolean,
  dotLength: number,
  forceSolid = false,
  errorLimit = 0,
): InkRender {
  const { size, dash, streamline } = props;
  const highlight = props.inkKind === 'highlight';
  const complete = props.inkAlgorithm !== 'reference' ||
    (!isDrawing && props.isComplete !== false);
  const isDashed =
    (dash === 'dashed' || dash === 'dotted') && points.length >= 2;
  const filled = isFilled(props);
  // The dashed stroke, its dash spacing, the simplified stroke, and a closed
  // stroke's fill are all the same curve. Conditioning it is the expensive half
  // of a render, so it is built once here rather than once per consumer.
  const centerline =
    isDashed || filled || forceSolid || highlight
      ? getInkCenterlineGeometry(
          points,
          size,
          streamline,
          props.inkAlgorithm,
          complete,
          errorLimit,
        )
      : EMPTY_INK_CENTERLINE;

  if (isDashed) {
    return {
      stroked: true,
      d: centerline.path,
      dash: dashProps(dash, size, isDrawing ? 0 : centerline.length, {
        inProgress: isDrawing,
        minDashLength: dotLength,
      }),
      fillPath: filled ? `${centerline.path} Z` : null,
    };
  }
  // A stroke of one point, or of several that the endpoint culling collapses
  // into one, has no centerline to stroke — only a dot, which the freehand
  // outline draws. Falling through keeps it visible rather than dropping it at
  // exactly the zoom the fallback was meant to help.
  if ((forceSolid || highlight) && centerline.path !== '') {
    return {
      stroked: true,
      d: centerline.path,
      dash: null,
      fillPath: filled ? `${centerline.path} Z` : null,
    };
  }
  return {
    stroked: false,
    d: getInkPathData(
      points,
      size,
      complete,
      {
        inkAlgorithm: props.inkAlgorithm,
        simulatePressure: props.simulatePressure,
        thinning: props.thinning,
        smoothing: props.smoothing,
        streamline,
        startTaper: props.startTaper,
        endTaper: complete ? props.endTaper : false,
        pressureEasing: props.pressureEasing,
        pressureWarmup: props.pressureWarmup,
        tiltAmount: props.tiltAmount,
      },
      errorLimit,
    ),
    dash: null,
    fillPath: filled ? `${centerline.path} Z` : null,
  };
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
    // Thinning in either direction can expand the stroke past half the brush
    // width, so reserve that largest possible radius for indexing/culling.
    const pad = maxInkRadius(s.props.size, s.props);
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
    const center = {
      x: s.x + (b.minX + b.maxX) / 2,
      y: s.y + (b.minY + b.maxY) / 2,
    };
    const wp = s.rotation ? rotatePoint(p, center, -s.rotation) : p;
    const local = { x: wp.x - s.x, y: wp.y - s.y };

    const r = tol + maxInkRadius(s.props.size, s.props);
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
      s.props.inkAlgorithm,
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
    // The same margin `getBounds` reserves: with half the brush here instead,
    // a thinning stroke jumped the moment a handle was grabbed.
    const { x, y, points } = resizePolyline(
      initial.props.points,
      initial.props.points,
      maxInkRadius(initial.props.size, initial.props),
      nb,
    );
    return { x, y, props: { ...initial.props, points } };
  },

  Component: ({ shape, inkPass = 'overlay' }) => {
    const { points, size, fillStyle } = shape.props;
    const highlight = shape.props.inkKind === 'highlight';
    const color = highlight ? highlightPaint(shape.props.color) : shape.props.color;
    // A dot is a zero-length dash, which browsers drop once the stroke is
    // sub-pixel wide — the dotted pencil vanished entirely when zoomed out.
    // Zoomed out, most of a stroke's path commands land inside a pixel;
    // `errorLimit` is the deviation the engine may take to drop them, 0 at and
    // above 1:1. One subscription for all four answers — see `useInkLod`.
    const { dotLength, dash, forceSolid, errorLimit } = useInkLod(
      shape.props.dash ?? 'solid',
      size,
    );
    if (points.length === 0) return null;
    // Always a settled stroke: while the local pointer is drawing one, the
    // canvas filters that shape out of this tree and the active-stroke layer
    // draws it instead, tail and all. So nothing here is ever `isDrawing`.
    const render = buildInkRender(
      { ...shape.props, dash },
      points,
      false,
      dotLength,
      forceSolid,
      errorLimit,
    );
    const b = pointsBounds(points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rotate = shape.rotation
      ? ` rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy})`
      : '';
    const transform = `translate(${shape.x} ${shape.y})${rotate}`;

    // Dashed/dotted ink — and any stroke too fine on screen to show a width
    // profile — strokes a uniform-width centerline (like lines and polygons);
    // otherwise solid keeps the variable-width freehand-engine fill.
    const ink = render.stroked ? (
      <path
        d={render.d}
        fill="none"
        stroke={color}
        strokeWidth={size}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={transform}
        {...render.dash}
      />
    ) : (
      <path d={render.d} fill={color} transform={transform} />
    );

    if (highlight) return <g opacity={inkPass === 'underlay' ? HIGHLIGHT_UNDERLAY_OPACITY : HIGHLIGHT_OVERLAY_OPACITY}>{ink}</g>;
    if (!render.fillPath) return ink;
    // Painted from the centerline closed back on itself, so the fill meets the
    // ink's inner edge rather than its outer one. Only closed strokes reach
    // here, so that seam is the gap the hand left, not an arbitrary chord.
    const f = fillFor(shape.id, color, fillStyle!);
    return (
      <>
        {f.pattern ? <defs>{f.pattern}</defs> : null}
        <path
          d={render.fillPath}
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
