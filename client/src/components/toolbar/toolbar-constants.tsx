import type { PolygonKind } from '@whiteboard/shared';
import { isDarwin } from '@/canvas/platform';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';

/** The toolbar's show-and-hide chord, as the platform writes it. */
export const HIDE_KEYS = isDarwin() ? '⌘.' : 'Ctrl+.';

export const POLYGON_KINDS: { kind: PolygonKind; label: string }[] = [
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'cloud', label: 'Cloud' },
  { kind: 'star', label: 'Star' },
];

/** Also the order they stand in, left to right, on the bar. */
export const NAVIGATE_TOOLS = ['select', 'hand', 'laser'] as const;
/** Also the order they stand in, left to right, on the bar. */
export const INKING_TOOLS = ['draw', 'highlighter', 'eraser'] as const;
/** Ruler-and-compass constructions, and measuring them. */
export const CONSTRUCTION_TOOLS = ['straightedge', 'compass', 'measure'] as const;
/** The tools behind the Shapes key; arrow and frame have keys of their own. */
export const SHAPE_MENU_TOOLS: readonly string[] = ['rectangle', 'ellipse', 'line', 'polygon'];
export const COMPACT_MORE_TOOLS = [
  'hand',
  'laser',
  'comment',
  'graph',
  'equation',
  'straightedge',
  'compass',
  'measure',
] as const;

export function polygonLabel(kind: PolygonKind): string {
  return POLYGON_KINDS.find((p) => p.kind === kind)?.label ?? 'Polygon';
}

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
