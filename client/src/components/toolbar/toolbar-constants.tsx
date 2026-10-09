import type { PolygonKind } from '@whiteboard/shared';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';

export const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
];

export const NAVIGATE_TOOLS = ['select', 'hand'] as const;
/** Also the order they stand in, left to right, on the bar. */
export const INKING_TOOLS = ['draw', 'highlighter', 'laser', 'eraser'] as const;
export const CREATION_TOOLS = ['text', 'comment'] as const;
export const STEM_TOOLS = ['graph', 'equation'] as const;
/** Ruler-and-compass constructions. */
export const CONSTRUCTION_TOOLS = ['straightedge', 'compass'] as const;
export const SHAPE_TOOLS = [
  'rectangle',
  'ellipse',
  'arrow',
  'line',
  'frame',
  'polygon',
] as const;
export const COMPACT_MORE_TOOLS = [
  'hand',
  'highlighter',
  'laser',
  'comment',
  'graph',
  'equation',
  'straightedge',
  'compass',
] as const;

/**
 * A flyout opened from the bar: same plate, same corner, compact padding.
 * `border-0` drops the popover primitive's own edge, which `.tbar-surface`
 * supplies instead.
 */
export const TOOL_FLYOUT =
  'tbar-surface tbar-menu border-0 origin-(--transform-origin) ' +
  'data-open:zoom-in-95 data-closed:zoom-out-95';

/** A geometric polygon icon, drawn to the glyph set's stroke weight. */
export function MiniShape({
  kind,
  size = 20,
  strokeWidth = 1.4,
}: {
  kind: PolygonKind;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <polygon
        points={polygonPointsForBox(kind, 2, 2, 12, 12)}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
      />
    </svg>
  );
}
