import type { ComponentType } from 'react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  LineSpline,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import type { EraserMode } from '@/canvas/use-canvas-ui-store';

/**
 * The option tables and the little glyphs that stand for each one.
 *
 * Shared, because a style control is drawn in two places now — the toolbar's
 * satellite bar and the legacy style panel — and a fill that reads as hatched
 * in one and crosshatched in the other is the kind of drift no test catches.
 */

export const FILLS: FillStyle[] = ['none', 'solid', 'hatch', 'crosshatch'];
export const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted', 'draw'];
export const SPLINES: LineSpline[] = ['linear', 'smooth'];

export const FILL_LABELS: Record<FillStyle, string> = {
  none: 'No fill',
  solid: 'Solid fill',
  hatch: 'Hatched fill',
  crosshatch: 'Crosshatched fill',
};
export const DASH_LABELS: Record<StrokeDash, string> = {
  solid: 'Solid stroke',
  dashed: 'Dashed stroke',
  dotted: 'Dotted stroke',
  draw: 'Hand-drawn stroke',
};
export const SPLINE_LABELS: Record<LineSpline, string> = {
  linear: 'Straight line',
  smooth: 'Smooth line',
};

export const FONTS: { family: FontFamily; label: string }[] = [
  { family: 'sans', label: 'Aa' },
  { family: 'serif', label: 'Aa' },
  { family: 'mono', label: 'Aa' },
  { family: 'hand', label: 'Aa' },
];

export const WEIGHTS: { weight: FontWeight; label: string }[] = [
  { weight: 400, label: 'Regular' },
  { weight: 500, label: 'Medium' },
  { weight: 600, label: 'Semibold' },
  { weight: 700, label: 'Bold' },
];

type AlignIcon = ComponentType<{
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
}>;

/** Four lines of uneven length, as real text is, set to one side. */
const ALIGN_LINES = [
  { y: 5, width: 17 },
  { y: 9.7, width: 11 },
  { y: 14.3, width: 14 },
  { y: 19, width: 8 },
];

function alignIcon(align: TextAlign): AlignIcon {
  return function Align(props) {
    return (
      <svg
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        {...props}
      >
        {ALIGN_LINES.map(({ y, width }) => {
          const x = align === 'start' ? 3.5 : align === 'end' ? 20.5 - width : 12 - width / 2;
          return <path key={y} d={`M${x} ${y}h${width}`} />;
        })}
      </svg>
    );
  };
}

export const ALIGNS: { align: TextAlign; Icon: AlignIcon }[] = [
  { align: 'start', Icon: alignIcon('start') },
  { align: 'middle', Icon: alignIcon('middle') },
  { align: 'end', Icon: alignIcon('end') },
];

export const ARROW_TOPOLOGIES: Array<{
  value: ArrowTopology;
  label: string;
  glyph: string;
}> = [
  { value: 'straight', label: 'Straight arrow', glyph: '—' },
  { value: 'arc', label: 'Curved arrow', glyph: '⌒' },
  { value: 'elbow', label: 'Elbow arrow', glyph: '└' },
];

/** One way of the hatching; crosshatch adds its mirror image. */
const HATCH = 'M4 12 L12 4 M7 13 L13 7 M3 9 L9 3';
const HATCH_MIRROR = 'M4 4 L12 12 M9 13 L3 7 M13 9 L7 3';

export function FillPreview({
  style,
  color = 'currentColor',
  className,
}: {
  style: FillStyle;
  /** What a solid fill is painted in. */
  color?: string;
  className?: string;
}) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true" className={className}>
      <rect
        x={2.5}
        y={2.5}
        width={11}
        height={11}
        rx={1.5}
        fill={style === 'solid' ? color : 'none'}
        fillOpacity={style === 'solid' ? 0.35 : undefined}
        stroke="currentColor"
        strokeWidth={1}
      />
      {/* Struck through, so an empty box reads as neither an unticked checkbox
          nor a dashed stroke. */}
      {style === 'none' ? (
        <path d="M3 13 L13 3" stroke="currentColor" strokeWidth={1} />
      ) : null}
      {style === 'hatch' || style === 'crosshatch' ? (
        <path
          d={style === 'hatch' ? HATCH : `${HATCH} ${HATCH_MIRROR}`}
          stroke="currentColor"
          strokeWidth={0.8}
        />
      ) : null}
    </svg>
  );
}

export function DashPreview({ dash }: { dash: StrokeDash }) {
  if (dash === 'draw') {
    return (
      <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
        <path
          d="M2 6.4 Q6 4.9 10 6.1 T20 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path
          d="M2 5.7 Q6 6.8 10 5.6 T20 6.3"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const dasharray =
    dash === 'dashed' ? '4 3' : dash === 'dotted' ? '0 4' : undefined;
  return (
    <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
      <line
        x1={2}
        y1={6}
        x2={20}
        y2={6}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
    </svg>
  );
}

/** Straight versus smoothed, drawn as the two paths through the same points. */
export function SplinePreview({ spline }: { spline: LineSpline }) {
  return (
    <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
      <path
        d={spline === 'smooth' ? 'M2 9 Q7 1 11 6 T20 3' : 'M2 9 L7 4 L11 8 L20 3'}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The amount itself: a disc drawn at the value, over the ring it would fill at
 * 100%. A percentage would be more precise and much slower to read, and this
 * key's job is only to say roughly how far down the fader is.
 */
export function OpacityPreview({ value }: { value: number }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <circle
        cx={8}
        cy={8}
        r={6}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        strokeOpacity={0.45}
      />
      <circle cx={8} cy={8} r={6} fill="currentColor" fillOpacity={value} />
    </svg>
  );
}

/**
 * Whole shapes: a closed box, which is the smallest thing that reads as "an
 * object" at this size. Drawn at the same 16px viewBox and 1.75 weight as its
 * sibling below so the two glyphs sit on one optical line.
 */
export function EraserObjectPreview() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x={3}
        y={3}
        width={10}
        height={10}
        rx={2.5}
        fill="currentColor"
        fillOpacity={0.18}
        stroke="currentColor"
        strokeWidth={1.75}
      />
    </svg>
  );
}

/** A stroke with a bite taken out of its middle: what precision mode does. */
export function EraserPrecisionPreview() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 11 A 6 6 0 0 1 5.95 5.36 M10.05 5.36 A 6 6 0 0 1 14 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  );
}

export const ERASER_MODES: {
  mode: EraserMode;
  label: string;
  Preview: () => React.JSX.Element;
}[] = [
  { mode: 'object', label: 'Object eraser', Preview: EraserObjectPreview },
  {
    mode: 'precision',
    label: 'Precision eraser',
    Preview: EraserPrecisionPreview,
  },
];
