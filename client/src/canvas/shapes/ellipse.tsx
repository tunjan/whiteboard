import { DEFAULT_SHAPE_STYLE } from './style';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { fillFor, strokeDashArray, strokeLineCap } from './render-style';
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

  // Basic bounding-box hit test (per spec); a true ellipse test can refine
  // this later without touching callers.
  hitTest: (s, p, tol) =>
    boxHitTest(s.x, s.y, s.props.w, s.props.h, s.rotation, p, tol),

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
    const { w, h, color, fillStyle, dash, size } = shape.props;
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
          stroke={color}
          strokeWidth={size}
          strokeDasharray={strokeDashArray(dash, size)}
          strokeLinecap={strokeLineCap(dash)}
        />
      </g>
    );
  },
};
