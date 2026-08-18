import { arrowHandleDrag, arrowHandles } from './connector-handles';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  arrowheadLength,
  arrowheadPath,
  arrowheadPoints,
  arrowPath,
  arrowPoints,
  pathMidpoint,
  polylineBounds,
  polylineHitTest,
  polylineTransform,
  resizePolyline,
  tangentAnchor,
} from './line-geometry';
import { polylineLength } from './perfect-dash';
import { dashProps, DrawnOutline } from './render-style';
import { useLodDash } from '../lod';
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
    topology: 'straight',
    bindings: {},
    label: '',
  }),

  // Pad bounds by the arrowhead length so heads aren't clipped/culled.
  getBounds: (s) => {
    const fontSize = Math.max(12, s.props.size * 3);
    const labelPad = s.props.label?.trim()
      ? s.props.label.trim().length * fontSize * 0.3 + fontSize
      : 0;
    return polylineBounds(
      s.x,
      s.y,
      arrowPoints(
        s.props.points,
        s.props.topology ??
          (Math.abs(s.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight'),
        s.props.bend ?? 0,
      ),
      Math.max(arrowheadLength(s.props.size), labelPad),
    );
  },

  hitTest: (s, p, tol) =>
    polylineHitTest(
      s.x,
      s.y,
      s.rotation,
      arrowPoints(
        s.props.points,
        s.props.topology ??
          (Math.abs(s.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight'),
        s.props.bend ?? 0,
      ),
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
      props: {
        ...initial.props,
        points,
        bend: (initial.props.bend ?? 0) * scale,
      },
    };
  },

  getHandles: (s) => arrowHandles(s),
  onHandleDrag: (s, handleId, point, opts) =>
    arrowHandleDrag(s, handleId, point, opts),

  Component: ({ shape }) => {
    const { points, color, size, arrowStart, arrowEnd, bend, label } =
      shape.props;
    const dash = useLodDash(shape.props.dash, size);
    if (points.length < 2) return null;
    const topology =
      shape.props.topology ?? (Math.abs(bend ?? 0) >= 0.5 ? 'arc' : 'straight');
    const bodyPoints = arrowPoints(points, topology, bend ?? 0);
    const first = bodyPoints[0]!;
    const last = bodyPoints[bodyPoints.length - 1]!;
    const startHead = arrowStart
      ? arrowheadPath(tangentAnchor(bodyPoints, true), first, size)
      : '';
    const endHead = arrowEnd
      ? arrowheadPath(tangentAnchor(bodyPoints, false), last, size)
      : '';
    const middle = pathMidpoint(bodyPoints);
    const tangentLength = Math.hypot(middle.tangent.x, middle.tangent.y) || 1;
    const labelPoint = {
      x: middle.point.x - (middle.tangent.y / tangentLength) * (size + 9),
      y: middle.point.y + (middle.tangent.x / tangentLength) * (size + 9),
    };
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
          bodyPoints,
          shape.rotation,
        )}
      >
        {dash === 'draw' ? (
          <>
            <DrawnOutline
              points={bodyPoints}
              seed={`${shape.id}:body`}
              color={color}
              size={size}
            />
            {arrowStart ? (
              <DrawnOutline
                points={arrowheadPoints(
                  tangentAnchor(bodyPoints, true),
                  first,
                  size,
                )}
                seed={`${shape.id}:start`}
                color={color}
                size={size}
              />
            ) : null}
            {arrowEnd ? (
              <DrawnOutline
                points={arrowheadPoints(
                  tangentAnchor(bodyPoints, false),
                  last,
                  size,
                )}
                seed={`${shape.id}:end`}
                color={color}
                size={size}
              />
            ) : null}
          </>
        ) : (
          <>
            <path
              d={arrowPath(points, topology, bend ?? 0)}
              {...stroke}
              {...dashProps(dash, size, polylineLength(bodyPoints))}
            />
            {startHead || endHead ? (
              <path d={`${startHead} ${endHead}`.trim()} {...stroke} />
            ) : null}
          </>
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
