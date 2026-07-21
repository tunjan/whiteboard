import type { EquationShape } from '@whiteboard/shared';
import {
  getEquationRender,
  requestEquationTypeset,
  useEquationRenderStore,
} from '../equation-render';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { DEFAULT_SHAPE_STYLE } from './style';
import type { ShapeUtil } from './types';

export const EQUATION_DEFAULT_FONT_SIZE = 28;
export const EQUATION_DEFAULT_SIZE = { w: 120, h: 48 } as const;

function EquationPlaceholder({
  shape,
  error = false,
  loading = false,
}: {
  shape: EquationShape;
  error?: boolean;
  loading?: boolean;
}) {
  const { w, h } = shape.props;
  const transform = rotationTransform(
    shape.x,
    shape.y,
    w,
    h,
    shape.rotation,
  );
  return (
    <g transform={transform}>
      <rect
        x={shape.x}
        y={shape.y}
        width={w}
        height={h}
        rx={6}
        fill={loading ? 'transparent' : 'var(--color-card)'}
        stroke={
          error ? 'var(--color-destructive)' : 'var(--color-border)'
        }
        strokeWidth={1}
        strokeDasharray={loading ? undefined : '5 4'}
        vectorEffect="non-scaling-stroke"
      />
      {!loading ? (
        <text
          x={shape.x + w / 2}
          y={shape.y + h / 2}
          dominantBaseline="central"
          textAnchor="middle"
          fill="var(--color-muted-foreground)"
          fontSize={Math.min(24, Math.max(12, h * 0.45))}
          fontFamily="serif"
          pointerEvents="none"
        >
          √x
        </text>
      ) : null}
    </g>
  );
}

export const equationUtil: ShapeUtil<'equation'> = {
  type: 'equation',
  canResize: true,

  getDefaultProps: () => ({
    latex: '',
    color: DEFAULT_SHAPE_STYLE.color,
    fontSize: EQUATION_DEFAULT_FONT_SIZE,
    w: EQUATION_DEFAULT_SIZE.w,
    h: EQUATION_DEFAULT_SIZE.h,
  }),

  getBounds: (shape) =>
    boxBounds(shape.x, shape.y, shape.props.w, shape.props.h),

  hitTest: (shape, point, tolerance) =>
    boxHitTest(
      shape.x,
      shape.y,
      shape.props.w,
      shape.props.h,
      shape.rotation,
      point,
      tolerance,
    ),

  resize: (initial, bounds) => {
    const targetHeight = Math.max(1, bounds.maxY - bounds.minY);
    const scale =
      initial.props.h > 0 ? targetHeight / initial.props.h : 1;
    return {
      x: bounds.minX,
      y: bounds.minY,
      props: {
        ...initial.props,
        fontSize: initial.props.fontSize * scale,
        w: initial.props.w * scale,
        h: initial.props.h * scale,
      },
    };
  },

  Component: ({ shape }) => {
    useEquationRenderStore((state) => state.version);
    const latex = shape.props.latex.trim();
    const entry = latex ? getEquationRender(latex) : undefined;

    if (latex && !entry) requestEquationTypeset(latex);
    if (!latex) return <EquationPlaceholder shape={shape} />;
    if (!entry) return <EquationPlaceholder shape={shape} loading />;
    if ('error' in entry) return <EquationPlaceholder shape={shape} error />;

    const { w, h, fontSize, color } = shape.props;
    const transform = rotationTransform(
      shape.x,
      shape.y,
      w,
      h,
      shape.rotation,
    );
    const scale = fontSize / 16;

    return (
      <g transform={transform}>
        <rect
          x={shape.x}
          y={shape.y}
          width={w}
          height={h}
          fill="transparent"
        />
        <g
          transform={`translate(${shape.x} ${shape.y}) scale(${scale})`}
          style={{ color }}
          pointerEvents="none"
        >
          {/* The cached MathJax SVG has no intrinsic dimensions. This numeric
              viewport gives its viewBox a stable 1:1 world-space box. */}
          <svg
            width={entry.width}
            height={entry.height}
            overflow="visible"
            dangerouslySetInnerHTML={{ __html: entry.svg }}
          />
        </g>
      </g>
    );
  },
};
