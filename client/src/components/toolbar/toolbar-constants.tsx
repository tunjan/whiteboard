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
  'laser',
  'comment',
  'graph',
  'equation',
] as const;

/**
 * A group of keys. No longer a recess: the grouping is carried by the space
 * around it — keys sit 2px apart inside a group and 18px apart across one, and
 * a gap that wide is read before a container is.
 *
 * A container earns its place on this bar only where it holds one control
 * whose positions have to be read against each other — the satellite's
 * segmented switches. Around several separate controls it was only drawing a
 * box to say "these three are near each other", which the space already said.
 *
 * The padding stays after the recess it used to describe: it is what keeps the
 * row 44px tall, which is what the instrument slots size themselves off.
 */
export const TOOL_GROUP = 'flex items-center gap-0.5 p-1';

/**
 * The selected tool: the one key on the bar drawn as a solid chip, inverted
 * out of the slab.
 *
 * Selection is still a change of plane — nothing here is raised or sunk, since
 * a shadow under a key would compete with the instruments, the only things on
 * the bar meant to read as objects. What changed is which way the plane moves.
 * A selected key used to be its recess filled back to white; with the recesses
 * gone there is nothing left to fill, and white on a white slab is nothing at
 * all. So the fill goes the other way, to the darkest ink the theme has, and
 * inverts the glyph on top of it.
 *
 * It still costs the bar no colour, which is the part that mattered: the ink
 * swatches, the instruments and the sticker key are spending colour already.
 */
export const TOOL_ACTIVE =
  'border-transparent bg-fg text-surface hover:bg-fg hover:text-surface active:bg-fg active:text-surface';

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
 * Idle keys carry nothing at all — no chip, no border, no card underneath.
 * They are a glyph on the board, so they take the halo (`tb-glyph`) that keeps
 * them off whatever has been drawn there, and they are drawn a step darker
 * than they used to be: `fg-muted` was a tone chosen against a white slab, and
 * there is no slab now. Hover fills a wash under the key.
 *
 * There is a single idle state now. It used to fork, because a key in a recess
 * hovered toward white while a key on the bar's slab had to go the other way,
 * and neither surface is left.
 */
export const TOOL_IDLE =
  'tb-glyph border-transparent bg-transparent text-fg-secondary hover:bg-tb-track hover:text-fg active:bg-tb-track';

/**
 * Round, because the bar is. Every key is a circle on a pill, and the flyouts
 * they open repeat it — one radius on the whole family instead of a ladder of
 * four that only held while the boxes were nested.
 */
export const TOOL_GEOMETRY =
  'tb-key relative group/button size-9 min-w-9 rounded-full p-0 duration-fast ease-out-quart';

export function toolButtonClass(active: boolean, pressed = false) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    active ? TOOL_ACTIVE : pressed ? TOOL_PRESSED : TOOL_IDLE,
  );
}

/** A bar control on the slab. Never `active` — nothing out here is a tool. */
export function chromeButtonClass(pressed = false) {
  return cn(
    buttonVariants({ variant: 'ghost', size: 'icon-md' }),
    TOOL_GEOMETRY,
    pressed ? TOOL_PRESSED : TOOL_IDLE,
  );
}

/**
 * A key in one of the bar's flyouts — the shapes grid, the sticker grid.
 * Stated once because it was stated four times, and three of those had drifted
 * apart on radius, on hover ink and on whether they had a pressed state at all.
 */
export function menuItemClass(selected: boolean) {
  return cn(
    'size-10 rounded-xl transition-colors duration-fast',
    selected
      ? TOOL_PRESSED
      : 'text-fg-secondary hover:bg-panel hover:text-fg active:bg-panel/80',
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
 *   SLOT  a placeholder that takes a key's height, so an instrument can hang
 *         out of the bar without ever making the bar taller.
 *   CLIP  the button. It starts well above the bar's top edge and ends at the
 *         slot's foot. Its top sits clear of the tallest drawing, so nothing
 *         is ever cut at the top: the tip is meant to stand out over the
 *         canvas. The bottom is a mask rather than a hard edge — the handle
 *         used to be sliced off flat behind the tray's front lip, and with the
 *         groove gone there is no lip for it to be cut against, so it fades
 *         out instead of ending in mid-air.
 *
 * The third box is gone with the groove. It was a chip filling the recess to
 * mark the loaded instrument, and there is no recess to fill; the instruments
 * say it themselves by standing up out of the row.
 */
export const INSTRUMENT_SLOT = 'relative w-12 shrink-0 self-stretch';

export const INSTRUMENT_CLIP =
  'group/slot tb-glyph absolute inset-x-0 -top-6 bottom-0 flex items-start justify-center ' +
  'overflow-hidden ' +
  '[mask-image:linear-gradient(to_bottom,#000_calc(100%_-_12px),transparent)] ' +
  '[-webkit-mask-image:linear-gradient(to_bottom,#000_calc(100%_-_12px),transparent)]';

/**
 * The row the instruments stand in. No fill and no corner: they lie on the
 * board like everything else on this bar, and an object needs no container to
 * be read as one.
 *
 * `items-stretch`, because the slots size themselves off it, and the padding
 * stays because it is what keeps the row as deep as a key is tall.
 */
export const INSTRUMENT_TRACK = 'flex items-stretch p-1';

/** The drawing itself: 36 x 72, 16px of it standing above the bar's top edge. */
export const INSTRUMENT_ART_WIDTH = 36;
export const INSTRUMENT_ART_HEIGHT = 72;

/**
 * The tray's flat palette. One line around every part, and one fill inside it.
 *
 * EDGE is that line — a soft shade rather than a black outline, so it draws
 * the silhouette without turning the objects into a set of stickers. BODY,
 * SEAM and DARK are the three neutrals every instrument is built from: the
 * white of a barrel, the joint printed across it, and the moulded black of a
 * cap or a grip. Shared so no two objects in the tray are white or black by
 * slightly different amounts.
 */
export const INSTRUMENT_EDGE = 'rgba(12, 10, 9, 0.22)';
export const INSTRUMENT_BODY = '#ffffff';
export const INSTRUMENT_SEAM = '#e7e3de';
export const INSTRUMENT_DARK = '#45403c';

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
 * Amber plastic, because the tray is read by silhouette first and colour
 * second, and every other hue here is taken — white pencil, pink eraser, dark
 * laser, and a marker that wears the live ink. A wide flat plate among narrow
 * barrels is unmistakable even before the colour lands.
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
        {/* Real holes rather than drawn ones: the mask punches them out of the
            plate so the slot behind shows through. */}
        <mask id="tb-stencil-holes">
          <rect x="0" y="0" width="28" height="56" fill="#ffffff" />
          <circle cx="14" cy="11" r="4" fill="#000000" />
          <path d="M14 16.6 18.5 24.6H9.5Z" fill="#000000" />
          <rect
            x="10"
            y="27.2"
            width="8"
            height="7.6"
            rx="1.3"
            fill="#000000"
          />
        </mask>
      </defs>
      <path d={plate} fill="#e3bd82" mask="url(#tb-stencil-holes)" />
      {/* The cut edge of the plate and of each hole, so the shapes read as
          punched through it and not as marks lying on it. */}
      <g
        fill="none"
        stroke={INSTRUMENT_EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      >
        <path d="M3.6 7.6Q3.6 5 6.2 5h15.6Q24.4 5 24.4 7.6V56" />
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
