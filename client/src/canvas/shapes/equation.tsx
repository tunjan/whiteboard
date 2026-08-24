import { useEffect, useRef, useState } from 'react';
import type { EquationShape } from '@whiteboard/shared';
import {
  requestEquationTypeset,
  useEquationRender,
  type EquationRender,
} from '../equation-render';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { DEFAULT_SHAPE_STYLE } from './style';
import type { ShapeUtil } from './types';

export const EQUATION_DEFAULT_FONT_SIZE = 28;
export const EQUATION_DEFAULT_SIZE = { w: 120, h: 48 } as const;

/**
 * How long the source must hold still before a typeset failure counts as a
 * mistake rather than a half-typed expression. The equation panel debounces its
 * error message by the same amount, so the shape and the panel change state
 * together.
 */
export const EQUATION_SETTLE_MS = 500;

type TypesetRender = Extract<EquationRender, { svg: string }>;

export type EquationDisplay =
  | { kind: 'typeset'; render: TypesetRender }
  | { kind: 'empty' }
  | { kind: 'loading' }
  | { kind: 'error' };

/**
 * What to draw for an equation, given its cache entry and whether the source
 * has stopped changing.
 *
 * A failure is only drawn as an error once the source settles. Every prefix of
 * an expression being typed fails to typeset too — `\f`, `\fra`, `\frac{`,
 * `\frac{a}` — so reacting to each one turns the entire time a user spends
 * typing into a flickering error box. Until the source settles the shape keeps
 * showing the last expression that did typeset, whose geometry is what the
 * shape box is still sized to, or a neutral loading box if there isn't one yet.
 */
export function equationDisplay(
  latex: string,
  entry: EquationRender | undefined,
  fallback: TypesetRender | null,
  settled: boolean,
): EquationDisplay {
  if (!latex) return { kind: 'empty' };
  if (!entry) return { kind: 'loading' };
  if (!('error' in entry)) return { kind: 'typeset', render: entry };
  if (settled) return { kind: 'error' };
  return fallback ? { kind: 'typeset', render: fallback } : { kind: 'loading' };
}

/** False while `latex` is still changing, true once it has held for a beat. */
function useSettledSource(latex: string): boolean {
  const [settled, setSettled] = useState(true);
  const previous = useRef(latex);
  useEffect(() => {
    // Skip the mount pass: an equation that arrives already broken (board load,
    // a collaborator's edit) should show its error straight away.
    if (previous.current === latex) return;
    previous.current = latex;
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), EQUATION_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [latex]);
  return settled;
}

/** Warning triangle drawn as geometry, so it survives PNG export unchanged. */
function ErrorGlyph({
  cx,
  cy,
  size,
}: {
  cx: number;
  cy: number;
  size: number;
}) {
  const half = size / 2;
  return (
    <g
      fill="none"
      stroke="var(--color-destructive)"
      strokeWidth={Math.max(1, size * 0.12)}
      strokeLinecap="round"
      strokeLinejoin="round"
      pointerEvents="none"
    >
      <path
        d={`M ${cx} ${cy - half} L ${cx + half * 0.92} ${cy + half * 0.72} L ${cx - half * 0.92} ${cy + half * 0.72} Z`}
      />
      <path d={`M ${cx} ${cy - half * 0.18} L ${cx} ${cy + half * 0.22}`} />
      <path d={`M ${cx} ${cy + half * 0.48} L ${cx} ${cy + half * 0.49}`} />
    </g>
  );
}

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
    <g
      transform={transform}
      role="img"
      aria-label={
        error
          ? `Invalid equation: ${shape.props.latex}`
          : loading
            ? `Rendering equation: ${shape.props.latex}`
            : 'Empty equation'
      }
    >
      <title>
        {error
          ? `Invalid equation: ${shape.props.latex}`
          : loading
            ? `Rendering equation: ${shape.props.latex}`
            : 'Empty equation'}
      </title>
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
      {loading ? null : error ? (
        // A glyph, not just the red stroke: status carried by color alone is
        // unreadable when zoomed out, and fails for color-blind viewers.
        <ErrorGlyph
          cx={shape.x + w / 2}
          cy={shape.y + h / 2}
          size={Math.min(20, Math.max(10, h * 0.4))}
        />
      ) : (
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
      )}
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
    const latex = shape.props.latex.trim();
    const inline = shape.props.inline ?? false;
    // Subscribes to this expression alone: a keystroke in the panel caches one
    // new prefix, and only the shapes showing *that* prefix should re-render.
    const entry = useEquationRender(latex, inline);
    const lastTypeset = useRef<TypesetRender | null>(null);
    const settled = useSettledSource(latex);

    if (latex && !entry) requestEquationTypeset(latex, inline);

    const display = equationDisplay(latex, entry, lastTypeset.current, settled);
    if (display.kind === 'typeset') lastTypeset.current = display.render;
    if (display.kind === 'empty') return <EquationPlaceholder shape={shape} />;
    if (display.kind === 'loading') {
      return <EquationPlaceholder shape={shape} loading />;
    }
    if (display.kind === 'error') {
      return <EquationPlaceholder shape={shape} error />;
    }

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
      <g
        transform={transform}
        role="img"
        aria-label={`Equation: ${latex}`}
      >
        <title>{`Equation: ${latex}`}</title>
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
            width={display.render.width}
            height={display.render.height}
            overflow="visible"
            dangerouslySetInnerHTML={{ __html: display.render.svg }}
          />
        </g>
      </g>
    );
  },
};
