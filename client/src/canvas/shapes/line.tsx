import { connectorHandleDrag, connectorHandles } from './connector-handles';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  curvePath,
  curvePoints,
  polylineBounds,
  polylineHitTest,
  polylineTransform,
  resizePolyline,
} from './line-geometry';
import { strokeDashArray } from './render-style';
import type { ShapeUtil } from './types';

export const lineUtil: ShapeUtil<'line'> = {
  type: 'line',
  canResize: true,

  getDefaultProps: () => ({
    points: [],
    color: DEFAULT_SHAPE_STYLE.color,
    size: DEFAULT_SHAPE_STYLE.size,
    dash: 'solid',
    bend: 0,
  }),

  getBounds: (s) =>
    polylineBounds(
      s.x,
      s.y,
      curvePoints(s.props.points, s.props.bend ?? 0),
      s.props.size / 2,
    ),

  hitTest: (s, p, tol) =>
    polylineHitTest(
      s.x,
      s.y,
      s.rotation,
      curvePoints(s.props.points, s.props.bend ?? 0),
      p,
      tol,
      s.props.size / 2,
    ),

  resize: (initial, nb) => {
    const { x, y, points, scale } = resizePolyline(
      initial.props.points,
      initial.props.size / 2,
      nb,
    );
    return {
      x,
      y,
      props: { ...initial.props, points, bend: (initial.props.bend ?? 0) * scale },
    };
  },

  getHandles: (s) => connectorHandles(s),
  onHandleDrag: (s, handleId, point) => connectorHandleDrag(s, handleId, point),

  Component: ({ shape }) => {
    const { points, color, size, dash, bend } = shape.props;
    if (points.length < 2) return null;
    const pts = curvePoints(points, bend ?? 0);
    return (
      <path
        d={curvePath(points, bend ?? 0)}
        fill="none"
        stroke={color}
        strokeWidth={size}
        strokeDasharray={strokeDashArray(dash, size)}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform={polylineTransform(shape.x, shape.y, pts, shape.rotation)}
      />
    );
  },
};
