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
export const INKING_TOOLS = [
  'draw',
  'highlighter',
  'wand',
  'eraser',
  'laser',
] as const;
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
  'wand',
  'laser',
  'comment',
  'graph',
  'equation',
] as const;

export const TOOL_ACTIVE =
  'tb-key-chip border-transparent bg-inverse text-fg-inverse hover:bg-inverse-hover hover:text-fg-inverse active:bg-inverse active:text-fg-inverse';

export const TOOL_PRESSED =
  'tb-key-sunken border-border-strong bg-panel text-fg hover:bg-panel active:bg-panel/90';

export const TOOL_IDLE =
  'border-transparent bg-transparent text-fg-secondary hover:bg-panel hover:text-fg active:bg-panel/80';

export const TOOL_GEOMETRY =
  'tb-key relative group/button size-9 min-w-9 rounded-lg p-0 duration-fast ease-out-quart';

export function toolButtonClass(active: boolean, pressed = false) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    active ? TOOL_ACTIVE : pressed ? TOOL_PRESSED : TOOL_IDLE,
  );
}

export function FlyoutCaret({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'pointer-events-none absolute bottom-1 right-1 flex size-1.5 items-center justify-center transition-colors duration-fast',
        active
          ? 'text-fg-inverse/70 group-hover/button:text-fg-inverse'
          : 'text-fg-subtle/70 group-hover/button:text-fg-secondary',
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
