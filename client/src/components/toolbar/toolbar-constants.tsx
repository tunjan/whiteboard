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

/**
 * A group of keys, and the whole reason the bar reads as grouped without a
 * rule anywhere on it: each group is a shallow recess cut into the slab, and
 * the keys stand in it. A container states the grouping at any bar width,
 * where a hairline has to be found and read first.
 *
 * `gap-0.5` rather than a wider gap, because inside a shared recess the keys
 * are one control with several positions, not several controls in a row.
 *
 * Its 16px corner is the bar's 20px less the bar's 4px padding, and the keys'
 * 12px is this less its own 4px — the three boxes are concentric, so no corner
 * on the bar looks tighter or looser than the one outside it.
 */
export const TOOL_GROUP =
  'flex items-center gap-0.5 rounded-2xl bg-tb-track p-1';

/**
 * The selected tool: its group's recess filled back in to white.
 *
 * Selection is a change of plane, not of relief and not of hue. Nothing on
 * this bar is raised or sunk — a shadow under the key would put it in
 * competition with the instruments, which are the only things here meant to
 * read as objects — and a chip that is simply lighter than what surrounds it
 * is found before it is read. It costs the bar no colour either, which
 * matters because the ink swatches, the instruments and the sticker key are
 * all spending colour already.
 */
export const TOOL_ACTIVE =
  'border-transparent bg-tb-accent text-tb-accent-fg hover:bg-tb-accent-hover hover:text-tb-accent-fg active:bg-tb-accent-hover active:text-tb-accent-fg';

/**
 * Engaged but not selected — tool lock, and a shape already chosen inside the
 * shape menu. Outlined rather than filled: a fill means "this is the tool the
 * pointer is holding", and only one key on the bar may claim that at a time.
 * The pale fill sits about where the recess does, so on the bar this reads as
 * a ruled key rather than a second selection, and it still reads where it is
 * used off the bar, inside the insert popover, on white.
 */
export const TOOL_PRESSED =
  'border-border-strong bg-panel text-fg hover:bg-panel active:bg-panel/90';

/**
 * Idle keys sit straight on the recess and go a step quieter in ink, so the
 * one key that has been filled is also the one drawn darkest. Hover is a
 * half-strength chip: the affordance is "this is what selecting looks like",
 * arrived at early.
 */
export const TOOL_IDLE =
  'border-transparent bg-transparent text-fg-muted hover:bg-tb-accent/60 hover:text-fg active:bg-tb-accent/80';

export const TOOL_GEOMETRY =
  'tb-key relative group/button size-9 min-w-9 rounded-xl p-0 duration-fast ease-out-quart';

export function toolButtonClass(active: boolean, pressed = false) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    active ? TOOL_ACTIVE : pressed ? TOOL_PRESSED : TOOL_IDLE,
  );
}

/** Icon size for a key on the bar. One constant so the groups stay optically level. */
export const TOOL_ICON = 'size-4.5';

/**
 * The rule between two groups of keys. A hairline rather than a gap: the bar
 * is wide enough that spacing alone stops reading as a grouping about halfway
 * along it.
 *
 * It runs the full depth of the bar, edge to edge, rather than floating as a
 * short centred tick. A rule that stops short of both edges reads as another
 * thing sitting on the slab; one that meets both edges reads as the slab being
 * divided — which is the whole claim being made. Bleeding through the bar's
 * own padding is what gets it there, so the bar states that padding once as
 * `--tb-pad` and every rule in it cancels exactly that.
 *
 * Requires a flex parent laid out `items-stretch`.
 */
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

/**
 * The tray slot, shared by the drawn instruments and by the shape cluster that
 * stands with them.
 *
 * Three boxes, because an object in a tray needs each of them to do a
 * different job:
 *
 *   SLOT  a placeholder that takes a key's height, so an instrument can hang
 *         out of the bar without ever making the bar taller.
 *   CLIP  the button. It starts well above the bar's top edge and ends at the
 *         slot's foot, and it is the `overflow-hidden` that cuts the handle
 *         off flat there — behind the tray's own front lip, which is the strip
 *         of recess left below the slots. Its top sits clear of the tallest
 *         drawing, so nothing is ever cut at the top: the tip is meant to
 *         stand out over the canvas.
 *   WELL  the visible key, aligned to the slot, so the chip that marks a
 *         loaded instrument is the same box on the same recess as every other
 *         selected key on the bar — even though the object standing in it is
 *         not contained by either.
 */
export const INSTRUMENT_SLOT = 'relative w-12 shrink-0 self-stretch';

export const INSTRUMENT_CLIP =
  'group/slot absolute inset-x-0 -top-6 bottom-0 flex items-start justify-center ' +
  'overflow-hidden rounded-t-xl';

export const INSTRUMENT_WELL =
  'pointer-events-none absolute inset-x-0 bottom-0 top-6 rounded-xl ' +
  'transition-[background-color,box-shadow] duration-fast ease-out-quart motion-reduce:transition-none';

/**
 * The tray's own recess. The same groove the glyph groups stand in, so the
 * instruments read as lying in the bar's middle section rather than on a
 * separate fixture — but `items-stretch`, because the slots size themselves
 * off it.
 */
export const INSTRUMENT_TRACK =
  'flex items-stretch rounded-2xl bg-tb-track p-1';

/** The drawing itself: 36 x 72, 16px of it standing above the bar's top edge. */
export const INSTRUMENT_ART_WIDTH = 36;
export const INSTRUMENT_ART_HEIGHT = 72;

/** The shade along a moulded edge. Shared so the tray's objects are lit alike. */
export const INSTRUMENT_EDGE = 'rgba(12, 10, 9, 0.22)';

/**
 * The shape menu's object: a drafting template, drawn to the same 28 x 56 box
 * as the instruments and hung in the tray beside them.
 *
 * It used to be the small glyph's three line marks blown up to tray scale, and
 * that was the thing wrong with it — five moulded objects and one wireframe,
 * so the eye read it as a mis-sized icon rather than as another thing lying in
 * the tray. A template is what a real tray of drawing tools would have in it,
 * and the shapes are cut clean through the plate, so what shows in the holes
 * is whatever the slot is doing underneath: the recess when it is idle, the
 * white chip when it is loaded.
 *
 * Amber translucent plastic, because the tray is read by silhouette first and
 * colour second, and every other hue here is taken — white pencil, pink
 * eraser, dark laser, and a marker that wears the live ink. A wide flat plate
 * among narrow barrels is unmistakable even before the colour lands.
 */
export function ShapeClusterObject({ className }: { className?: string }) {
  const plate = 'M3.6 7.6Q3.6 5 6.2 5h15.6Q24.4 5 24.4 7.6V56H3.6Z';
  return (
    <svg
      viewBox="0 0 28 56"
      width={INSTRUMENT_ART_WIDTH}
      height={INSTRUMENT_ART_HEIGHT}
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/* Lit across the width the same way the pencil barrel is, so a flat
            fill reads as a moulded plate rather than as a printed rectangle. */}
        <linearGradient
          id="tb-stencil-plate"
          x1="3.6"
          y1="0"
          x2="24.4"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#cf9d55" />
          <stop offset="0.18" stopColor="#fbe2b8" />
          <stop offset="0.48" stopColor="#f5d3a0" />
          <stop offset="0.84" stopColor="#e4b878" />
          <stop offset="1" stopColor="#c08f4d" />
        </linearGradient>
        {/* Real holes rather than drawn ones: the mask punches them out of the
            plate so the slot behind shows through. */}
        <mask id="tb-stencil-holes">
          <rect x="0" y="0" width="28" height="56" fill="#ffffff" />
          <circle cx="14" cy="11" r="4" fill="#000000" />
          <path d="M14 16.6 18.5 24.6H9.5Z" fill="#000000" />
          <rect
            x="9.9"
            y="30"
            width="8.2"
            height="8.2"
            rx="1.3"
            fill="#000000"
          />
        </mask>
      </defs>
      <path
        d={plate}
        fill="url(#tb-stencil-plate)"
        mask="url(#tb-stencil-holes)"
      />
      <path
        d={plate}
        fill="none"
        stroke={INSTRUMENT_EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The cut edge of each hole, so the shapes read as punched through the
          plate and not as marks lying on it. */}
      <g
        fill="none"
        stroke={INSTRUMENT_EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      >
        <circle cx="14" cy="11" r="4" />
        <path d="M14 16.6 18.5 24.6H9.5Z" />
        <rect x="10" y="27.2" width="8" height="7.6" rx="1.3" />
      </g>
    </svg>
  );
}

/**
 * The shape menu's resting glyph: a square, an arrow and a circle arranged as
 * a loose cluster, which says "the shapes" the way no single shape can. Only
 * shown when no shape tool is active — once one is, the trigger draws that
 * shape instead, because then it has something more specific to say.
 */
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

/**
 * `className` exists for the tray, where the caret's containing block is the
 * clipping window rather than the key — and that window ends below the bar's
 * lower edge, so the default inset would park the caret in mid-air under the
 * bar. Tray callers push it back up by the bar's own padding.
 */
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
        'pointer-events-none absolute bottom-1 right-1 flex size-1.5 items-center justify-center transition-colors duration-fast',
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
