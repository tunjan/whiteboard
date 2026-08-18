import { Ellipse2d } from '../geometry2d';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  boxBounds,
  boxHitTest,
  rotationTransform,
  unrotatedPoint,
} from './box-geometry';
import { ellipsePerimeter } from './perfect-dash';
import { ellipseSynthesisPoints } from './geometry-synthesis';
import {
  dashProps,
  DrawnOutline,
  fillFor,
  strokeLineCap,
} from './render-style';
import { useLodDash } from '../lod';
import type { ShapeUtil } from './types';

export const ellipseUtil: ShapeUtil<'ellipse'> = {
  type: 'ellipse',
  canResize: true,

  getDefaultProps: () => ({
    w: 100,
    h: 100,
    color: DEFAULT_SHAPE_STYLE.color,
    fillStyle: 'none',
    dash: 'solid',
    size: DEFAULT_SHAPE_STYLE.size,
  }),

  getBounds: (s) => boxBounds(s.x, s.y, s.props.w, s.props.h),

  // The box is the broad phase, the ellipse itself decides. A click into the
  // corner of a circle's box lands 29% of the box's width from anything drawn,
  // so the box alone makes a wide band of empty space selectable.
  //
  // `size / 2` widens the target by the half of the stroke painted outside the
  // outline, matching what a marquee treats as part of the shape. An unfilled
  // ellipse is grabbable across its stroke; a filled one anywhere inside.
  hitTest: (s, p, tol) => {
    const { w, h, size, fillStyle } = s.props;
    const margin = tol + size / 2;
    if (!boxHitTest(s.x, s.y, w, h, s.rotation, p, margin)) return false;
    return new Ellipse2d(s.x + w / 2, s.y + h / 2, w / 2, h / 2, {
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
    const { w, h, color, fillStyle, size } = shape.props;
    const dash = useLodDash(shape.props.dash, size);
    const f = fillFor(shape.id, color, fillStyle);
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        {f.pattern ? <defs>{f.pattern}</defs> : null}
        <ellipse
          cx={shape.x + w / 2}
          cy={shape.y + h / 2}
          rx={w / 2}
          ry={h / 2}
          fill={f.fill}
          fillOpacity={f.fillOpacity}
          stroke={dash === 'draw' ? 'none' : color}
          strokeWidth={size}
          strokeLinecap={strokeLineCap(dash)}
          {...dashProps(dash, size, ellipsePerimeter(w / 2, h / 2), {
            closed: true,
          })}
        />
        {dash === 'draw' ? (
          <DrawnOutline
            points={ellipseSynthesisPoints(
              shape.x + w / 2,
              shape.y + h / 2,
              w / 2,
              h / 2,
            )}
            seed={shape.id}
            color={color}
            size={size}
            closed
          />
        ) : null}
      </g>
    );
  },
};
