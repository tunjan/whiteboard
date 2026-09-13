import type { CSSProperties } from 'react';
import type { PolygonKind } from '@whiteboard/shared';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
];

export const NAVIGATE_TOOLS = ['select', 'hand'] as const;
/** Also the order they stand in, left to right, in the toolbar's tray. */
export const INKING_TOOLS = ['draw', 'highlighter', 'eraser', 'laser'] as const;
export const CREATION_TOOLS = ['text', 'comment'] as const;
export const STEM_TOOLS = ['graph', 'equation'] as const;
export const SHAPE_TOOLS = [
  'rectangle',
  'ellipse',
  'arrow',
  'line',
  'frame',
  'polygon',
] as const;
export const COMPACT_PRIMARY_TOOLS = [
  'select',
  'draw',
  'eraser',
  'text',
] as const;
export const COMPACT_MORE_TOOLS = [
  'hand',
  'highlighter',
  'laser',
  'comment',
  'graph',
  'equation',
] as const;

export const TOOL_GROUP = 'flex items-center gap-1 p-1';

export const TOOL_HUE: Record<string, string> = {
  select: '#4f8bf5',
  hand: '#8f8ce8',
  draw: '#5b9bf3',
  highlighter: '#f0b429',
  eraser: '#f2848b',
  laser: '#f4623a',
  text: '#5b9bf3',
  graph: '#3fae7a',
  equation: '#4aab72',
  comment: '#ef7f9b',
  lock: '#4f8bf5',
  sticker: '#9b7bec',
  shapes: '#e0a33f',
  rectangle: '#e0a33f',
  ellipse: '#e0a33f',
  arrow: '#e0a33f',
  line: '#e0a33f',
  frame: '#e0a33f',
  polygon: '#e0a33f',
};

/** Anything with no hue of its own — the bar's own chrome — is plain grey. */
export const TOOL_HUE_NEUTRAL = '#98a1ab';

export function hueVars(id?: string): CSSProperties {
  return {
    ['--key-hue' as string]: (id && TOOL_HUE[id]) || TOOL_HUE_NEUTRAL,
  };
}

export const TOOL_GEOMETRY =
  'tb-key relative z-10 group/button size-10 min-w-10 rounded-full p-0 duration-base active:scale-[0.96] motion-reduce:active:scale-100';

export function toolKeyClass() {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    'tb-hue border-transparent bg-transparent hover:bg-transparent active:bg-transparent',
  );
}

export function menuItemClass(selected: boolean) {
  return cn(
    'size-10 rounded-[0.875rem] transition-all duration-fast ease-out-quart active:scale-95 motion-reduce:active:scale-100',
    selected
      ? 'border-transparent bg-tb-chip text-fg hover:bg-tb-chip'
      : 'text-fg-secondary hover:bg-tb-track hover:text-fg active:bg-tb-track',
  );
}

/** Icon size for a key on the bar. One constant so the groups stay optically level. */
export const TOOL_ICON = 'size-4.5';

export const TOOL_FLYOUT =
  'lg lg-card border-0 origin-(--transform-origin) ' +
  'data-open:zoom-in-95 data-closed:zoom-out-95';

export function ToolbarDivider({ className }: { className?: string } = {}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mx-1.5 w-px shrink-0 self-stretch bg-tb-divider',
        'my-[calc(var(--tb-pad,0px)*-1)]',
        className,
      )}
    />
  );
}

/** Full instruments fit inside a generous, pastel-backed slot. */
export const INSTRUMENT_SLOT = 'tb-slot relative w-10 shrink-0 self-stretch';
export const INSTRUMENT_CLIP =
  'group/slot tb-object absolute inset-0 flex items-center justify-center rounded-full';
export const INSTRUMENT_TRACK = 'flex items-stretch gap-1 p-1';
export const INSTRUMENT_TILT = 'rotate-[16deg] origin-center';
export const INSTRUMENT_ART_WIDTH = 28;
export const INSTRUMENT_ART_HEIGHT = 56;

/** The reference's stacked shapes, printed on a soft amber tile. */
export function ShapeClusterObject({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 28 56"
      width={28}
      height={46}
      className={className}
      aria-hidden="true"
    >
      <g fill="currentColor">
        <circle cx="14" cy="12" r="6" />
        <path d="M13 22Q14 20 15 22L20 31Q21 33 19 33H9Q7 33 8 31Z" />
        <rect x="8" y="37" width="12" height="12" rx="2" />
      </g>
    </svg>
  );
}

export function ShapeClusterGlyph({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.75" y="3" width="8.5" height="8.5" rx="1.6" />
      <path d="M14.25 9.75 20.75 3.25" />
      <path d="M16.25 3.25h4.5v4.5" />
      <circle cx="16.25" cy="16.75" r="4.5" />
    </svg>
  );
}

export function FlyoutCaret({
  active,
  className,
}: {
  active: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute bottom-1 right-1 flex size-1.5 items-center justify-center transition-colors duration-base ease-out-quart',
        active
          ? 'text-fg/50 group-hover/button:text-fg'
          : 'text-fg-subtle/70 group-hover/button:text-fg-secondary',
        className,
      )}
    >
      <svg width="5" height="5" viewBox="0 0 5 5" fill="currentColor">
        <path d="M5 5L0 5L5 0Z" />
      </svg>
    </span>
  );
}

/**
 * Geometric polygon icon renderer.
 */
export function MiniShape({
  kind,
  size = 16,
}: {
  kind: PolygonKind;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <polygon
        points={polygonPointsForBox(kind, 2, 2, 12, 12)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}
