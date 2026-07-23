import {
  distance,
  distanceToSegment,
  pointsBounds,
  rotatePoint,
} from '@whiteboard/shared';
import { DEFAULT_SHAPE_STYLE, DEFAULT_INK_SIZE } from './style';
import {
  DEFAULT_PENCIL_DYNAMICS,
  getInkCenterlinePath,
  getInkPathData,
} from './ink';
import { strokeDashArray } from './render-style';
import type { ShapeUtil } from './types';

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
    for (let i = 0; i < pts.length - 1; i++) {
      if (distanceToSegment(local, pts[i]!, pts[i + 1]!) <= r) return true;
    }
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
      simulatePressure,
      thinning,
      smoothing,
      streamline,
      startTaper,
      endTaper,
    } = shape.props;
    if (points.length === 0) return null;
    const b = pointsBounds(points);
    const cx = (b.minX + b.maxX) / 2;
    const cy = (b.minY + b.maxY) / 2;
    const rotate = shape.rotation
      ? ` rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy})`
      : '';
    const transform = `translate(${shape.x} ${shape.y})${rotate}`;

    // Dashed/dotted ink strokes a uniform-width centerline (like lines and
    // polygons); solid keeps the variable-width freehand-engine fill.
    if (dash && dash !== 'solid' && points.length >= 2) {
      return (
        <path
          d={getInkCenterlinePath(points)}
          fill="none"
          stroke={color}
          strokeWidth={size}
          strokeDasharray={strokeDashArray(dash, size)}
          strokeLinecap="round"
          strokeLinejoin="round"
          transform={transform}
        />
      );
    }

    const d = getInkPathData(points, size, true, {
      simulatePressure,
      thinning,
      smoothing,
      streamline,
      startTaper,
      endTaper,
    });
    return <path d={d} fill={color} transform={transform} />;
  },
};
