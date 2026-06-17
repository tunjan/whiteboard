import { connectorHandleDrag, connectorHandles } from './connector-handles';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  arrowheadLength,
  arrowheadPath,
  curvePath,
  curvePoints,
  polylineBounds,
  polylineHitTest,
  polylineTransform,
  resizePolyline,
  tangentAnchor,
} from './line-geometry';
import { strokeDashArray } from './render-style';
import type { ShapeUtil } from './types';

export const arrowUtil: ShapeUtil<'arrow'> = {
  type: 'arrow',
  canResize: true,

  getDefaultProps: () => ({
    points: [],
    color: DEFAULT_SHAPE_STYLE.color,
    size: DEFAULT_SHAPE_STYLE.size,
    dash: 'solid',
    arrowStart: false,
    arrowEnd: true,
    bend: 0,
  }),

  // Pad bounds by the arrowhead length so heads aren't clipped/culled.
  getBounds: (s) =>
    polylineBounds(
      s.x,
      s.y,
      curvePoints(s.props.points, s.props.bend ?? 0),
      arrowheadLength(s.props.size),
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
      arrowheadLength(initial.props.size),
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
    const { points, color, size, dash, arrowStart, arrowEnd, bend } = shape.props;
    if (points.length < 2) return null;
    const b = bend ?? 0;
    const first = points[0]!;
    const last = points[points.length - 1]!;
    // Arrowheads stay solid even when the line is dashed/dotted, and follow the
    // curve's tangent at each end.
    let heads = '';
    if (arrowEnd) heads += ` ${arrowheadPath(tangentAnchor(points, b, false), last, size)}`;
    if (arrowStart) heads += ` ${arrowheadPath(tangentAnchor(points, b, true), first, size)}`;
    const stroke = {
      stroke: color,
      strokeWidth: size,
      strokeLinecap: 'round' as const,
      strokeLinejoin: 'round' as const,
      fill: 'none' as const,
    };
    return (
      <g
        transform={polylineTransform(
          shape.x,
          shape.y,
          curvePoints(points, b),
          shape.rotation,
        )}
      >
        <path
          d={curvePath(points, b)}
          {...stroke}
          strokeDasharray={strokeDashArray(dash, size)}
        />
        {heads ? <path d={heads.trim()} {...stroke} /> : null}
      </g>
    );
  },
};
