import { lineHandleDrag, lineHandles } from './connector-handles';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  curvePath,
  curvePoints,
  pathMidpoint,
  polylineBounds,
  polylineHitTest,
  polylineTransform,
  resizePolyline,
} from './line-geometry';
import { polylineLength } from './perfect-dash';
import { dashProps, DrawnOutline } from './render-style';
import { useLodDash } from '../lod';
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
    spline: 'linear',
    label: '',
  }),

  getBounds: (s) => {
    const fontSize = Math.max(12, s.props.size * 3);
    const labelPad = s.props.label?.trim()
      ? Math.max(
          s.props.size / 2,
          s.props.label.trim().length * fontSize * 0.3 + fontSize,
        )
      : s.props.size / 2;
    return polylineBounds(
      s.x,
      s.y,
      curvePoints(
        s.props.points,
        s.props.bend ?? 0,
        s.props.spline ?? 'linear',
      ),
      labelPad,
    );
  },

  hitTest: (s, p, tol) =>
    polylineHitTest(
      s.x,
      s.y,
      s.rotation,
      curvePoints(
        s.props.points,
        s.props.bend ?? 0,
        s.props.spline ?? 'linear',
      ),
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
      props: {
        ...initial.props,
        points,
        bend: (initial.props.bend ?? 0) * scale,
      },
    };
  },

  // Traced, not boxed: the selection outline is the line's own centerline, so
  // the gap between two bends stays clickable for whatever is under it.
  getIndicatorPath: (s) => {
    const { points, bend, spline } = s.props;
    if (points.length < 2) return null;
    return {
      d: curvePath(points, bend ?? 0, spline ?? 'linear'),
      transform: polylineTransform(
        s.x,
        s.y,
        curvePoints(points, bend ?? 0, spline ?? 'linear'),
        s.rotation,
      ),
    };
  },

  getHandles: (s) => lineHandles(s),
  onHandleDrag: (s, handleId, point, opts) =>
    lineHandleDrag(s, handleId, point, opts),

  Component: ({ shape }) => {
    const { points, color, size, bend, spline, label } = shape.props;
    const dash = useLodDash(shape.props.dash, size);
    if (points.length < 2) return null;
    const pts = curvePoints(points, bend ?? 0, spline ?? 'linear');
    const middle = pathMidpoint(pts);
    const tangentLength = Math.hypot(middle.tangent.x, middle.tangent.y) || 1;
    const labelPoint = {
      x: middle.point.x - (middle.tangent.y / tangentLength) * (size + 9),
      y: middle.point.y + (middle.tangent.x / tangentLength) * (size + 9),
    };
    return (
      <g transform={polylineTransform(shape.x, shape.y, pts, shape.rotation)}>
        {dash === 'draw' ? (
          <DrawnOutline
            points={pts}
            seed={shape.id}
            color={color}
            size={size}
          />
        ) : (
          <path
            d={curvePath(points, bend ?? 0, spline ?? 'linear')}
            fill="none"
            stroke={color}
            strokeWidth={size}
            strokeLinecap="round"
            strokeLinejoin="round"
            {...dashProps(dash, size, polylineLength(pts))}
          />
        )}
        {label?.trim() ? (
          <text
            x={labelPoint.x}
            y={labelPoint.y}
            fill={color}
            stroke="var(--color-background)"
            strokeWidth={4}
            paintOrder="stroke"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="'Inter Variable', system-ui, sans-serif"
            fontSize={Math.max(12, size * 3)}
          >
            {label.trim()}
          </text>
        ) : null}
      </g>
    );
  },
};
