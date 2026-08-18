import { Polygon2d } from '../geometry2d';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  boxBounds,
  boxHitTest,
  rotationTransform,
  unrotatedPoint,
} from './box-geometry';
import { polygonPointsForBox, polygonVerticesForBox } from './polygon-geometry';
import { DashedOutline, DrawnOutline, fillFor } from './render-style';
import { useLodDash } from '../lod';
import type { ShapeUtil } from './types';

export const polygonUtil: ShapeUtil<'polygon'> = {
  type: 'polygon',
  canResize: true,

  getDefaultProps: () => ({
    w: 100,
    h: 100,
    kind: 'triangle',
    color: DEFAULT_SHAPE_STYLE.color,
    fillStyle: 'none',
    dash: 'solid',
    size: DEFAULT_SHAPE_STYLE.size,
  }),

  getBounds: (s) => boxBounds(s.x, s.y, s.props.w, s.props.h),

  // The box is the broad phase, the outline decides — see `ellipseUtil`. A
  // triangle leaves half its box empty, and the two upper corners were the
  // easiest part of it to hit.
  hitTest: (s, p, tol) => {
    const { w, h, kind, size, fillStyle } = s.props;
    const margin = tol + size / 2;
    if (!boxHitTest(s.x, s.y, w, h, s.rotation, p, margin)) return false;
    return new Polygon2d(polygonVerticesForBox(kind, s.x, s.y, w, h), {
      isFilled: fillStyle !== 'none',
    }).hitTestPoint(unrotatedPoint(s.x, s.y, w, h, s.rotation, p), margin);
  },

  resize: (initial, nb) => ({
    x: nb.minX,
    y: nb.minY,
    props: {
      ...initial.props,
      w: Math.max(1, nb.maxX - nb.minX),
      h: Math.max(1, nb.maxY - nb.minY),
    },
  }),

  Component: ({ shape }) => {
    const { w, h, kind, color, fillStyle, size } = shape.props;
    const dash = useLodDash(shape.props.dash, size);
    const f = fillFor(shape.id, color, fillStyle);
    const points = polygonVerticesForBox(kind, shape.x, shape.y, w, h);
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        {f.pattern ? <defs>{f.pattern}</defs> : null}
        <polygon
          points={polygonPointsForBox(kind, shape.x, shape.y, w, h)}
          fill={f.fill}
          fillOpacity={f.fillOpacity}
          stroke={dash === 'solid' ? color : 'none'}
          strokeWidth={size}
          strokeLinejoin="round"
        />
        {dash === 'draw' ? (
          <DrawnOutline
            points={points}
            seed={shape.id}
            color={color}
            size={size}
            closed
          />
        ) : dash === 'dashed' || dash === 'dotted' ? (
          <DashedOutline
            points={points}
            dash={dash}
            color={color}
            size={size}
          />
        ) : null}
      </g>
    );
  },
};
