import { useRef } from 'react';
import {
  paletteColors,
  SIZE_OPTIONS,
  useStyleStore,
  type PaletteColor,
} from '@/canvas/use-style-store';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';

/**
 * The quick set, held as palette slot indices rather than hex values so it
 * follows the theme the way every other swatch in the app does. Slot 0 is the
 * ink swatch (black on the light canvas, white on the dark one), then blue,
 * green, red — the four a tutor reaches for without thinking. The remaining
 * eight stay in the style panel, which is where a deliberate color choice
 * belongs.
 */
const QUICK_SLOTS = [0, 4, 8, 11];

/**
 * Tools whose quick properties ride here. The wand draws pen strokes, so it
 * takes the pen's controls — the same rule the style panel applies.
 */
const COLOR_TOOLS = new Set(['draw', 'highlighter', 'wand', 'text']);

/**
 * Text is absent by necessity, not oversight: it has no stroke width. Its size
 * is `fontSize` on the shape, which the style store does not carry and the
 * panel's own size row skips for the same reason. So the row drops out and the
 * bar shows color alone, rather than offering a control that writes nowhere.
 */
const SIZE_TOOLS = new Set(['draw', 'highlighter', 'wand']);

/**
 * Dot diameters for the four stroke presets. Deliberately not the world-unit
 * widths: those run 2→10, and a ramp that literal either starts invisible or
 * ends wider than the key it sits in. These preserve the ordering and the sense
 * of acceleration at a size that reads inside a 32px target.
 */
const DOT_SIZES = [5, 7.5, 10, 13];

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * The quick slots under `colors`, plus the live color when it is not one of
 * them. Same rule as the style panel's grid: a swatch row with nothing selected
 * reads as "no color set", so a color chosen outside this set joins the row
 * rather than leaving it blank.
 */
export function quickSwatches(
  colors: PaletteColor[],
  color: string,
): PaletteColor[] {
  const quick = QUICK_SLOTS.flatMap((slot) => colors[slot] ?? []);
  return quick.some((c) => c.value === color)
    ? quick
    : [...quick, { name: 'Current color', value: color }];
}

/** −1 for a backwards arrow, 1 for a forwards one, 0 for anything else. */
function arrowDelta(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

/**
 * The active tool's two most-used properties — color, and stroke weight where
 * the tool has one — as a ribbon that rises out of the toolbar's top edge.
 *
 * It exists for the same reason the eraser's mode selector does: the setting
 * belongs to the tool, so it should land where the pointer already is instead
 * of costing a trip to the top-right style panel mid-stroke. That panel keeps
 * the full set — twelve swatches, fill, dash, opacity, type — and stays the
 * place a considered choice is made; this is the fast path for the choice made
 * a dozen times a minute.
 *
 * It is a riser off the bar, not a pill above it. Four things do that work and
 * all four are load-bearing:
 *
 *  - Flush. `bottom-full` and nothing else: no gutter, and no overlap either.
 *    The ribbon carries no bottom border, so the bar's top border *is* its
 *    bottom edge, and the two outlines meet as one line.
 *  - The `docked` material, which is the whole of the depth cue. The bar is
 *    `surface`; the ribbon is `panel`, one step darker in both themes. Planes
 *    are separated by tone here, never by relief — a sheen and a lit rim would
 *    put a bevel on the seam and read as moulding rather than as distance. It
 *    also flips the ghost controls so they hover *forward* to `surface` instead
 *    of back into `panel`.
 *  - Square bottom corners, rounded top. It is narrower than the bar, so those
 *    square corners land mid-edge and never meet the bar's own rounding — the
 *    riser looks stamped from the same sheet.
 *
 * It opens by growing upward out of that edge, on `grid-template-rows` 0fr→1fr
 * so the height animates without measuring anything and the contents are
 * revealed rather than scaled. `bottom-full` pins the bottom edge to the bar,
 * which is what sends the growth upward.
 *
 * Horizontally it left-aligns to the bar's padding edge, which puts it over the
 * inking keys — the ones whose properties it carries. Alignment is desktop-only:
 * the compact bar is narrower than the ribbon, so the ribbon centres there
 * instead of hanging off the side of a phone screen.
 *
 * Mounted at all times and hidden with opacity so it animates out as well as
 * in; `inert` keeps the hidden copy out of the tab order and off the a11y tree.
 * Callers must place it inside a positioned ancestor.
 */
export function ToolPropertiesSatellite({
  activeToolId,
}: {
  activeToolId: string;
}) {
  const color = useStyleStore((s) => s.color);
  const size = useStyleStore((s) => s.size);
  const setColor = useStyleStore((s) => s.setColor);
  const setSize = useStyleStore((s) => s.setSize);
  const theme = useThemeStore((s) => s.theme);

  const active = COLOR_TOOLS.has(activeToolId);

  // Which tool's controls to draw. Pinned to the last tool that had any, so
  // switching to the select tool collapses the ribbon whole instead of dropping
  // the stroke row on the first frame of the close.
  const shownTool = useRef(activeToolId);
  if (active) shownTool.current = activeToolId;
  const showSize = SIZE_TOOLS.has(shownTool.current);

  const swatches = quickSwatches(paletteColors(theme), color);

  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sizeRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sizeIndex = SIZE_OPTIONS.findIndex((option) => option.value === size);

  // Radiogroup convention in both rows, matching the style panel and the
  // eraser's selector: an arrow moves the choice, and focus follows it.
  const onSwatchKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    const index = swatchRefs.current.indexOf(event.target as HTMLButtonElement);
    const next = (index + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    setColor(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  const onSizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    const from = sizeIndex < 0 ? 0 : sizeIndex;
    const next =
      (from + arrowDelta(event.key) + SIZE_OPTIONS.length) %
      SIZE_OPTIONS.length;
    const option = SIZE_OPTIONS[next];
    if (!option) return;
    setSize(option.value);
    sizeRefs.current[next]?.focus();
  };

  return (
    <div
      aria-hidden={!active}
      inert={!active}
      className={cn(
        'absolute bottom-full grid w-max',
        // `left-1.5` is the bar's own `p-1.5`, so the ribbon's left edge lands
        // exactly where the first tool key starts — a landmark on the bar
        // rather than an offset from its middle. Centred below `sm`, where the
        // ribbon is wider than the compact bar and would run off the screen.
        'left-1/2 -translate-x-1/2 sm:left-1.5 sm:translate-x-0',
        'transition-[grid-template-rows,opacity] duration-base ease-out-quart',
        'motion-reduce:transition-none',
        active
          ? 'grid-rows-[1fr] opacity-100'
          : 'pointer-events-none grid-rows-[0fr] opacity-0',
      )}
    >
      {/* The clip the height animation runs against. The bar's `p-1.5` is
          matched inside it for a reason: focus is a 2px outline at 2px offset,
          and anything tighter would clip it against this edge. */}
      <div className="overflow-hidden">
        <Surface
          mode="docked"
          chrome
          role="group"
          aria-label="Tool properties"
          className="flex items-center rounded-xl rounded-b-none border-b-0 p-1.5"
        >
          <div
            role="radiogroup"
            aria-label="Color"
            onKeyDown={onSwatchKeyDown}
            className="flex items-center"
          >
            {swatches.map((swatch, index) => {
              const selected = swatch.value === color;
              return (
                <Tooltip key={swatch.value}>
                  <TooltipTrigger
                    render={
                      <button
                        ref={(node) => {
                          swatchRefs.current[index] = node;
                        }}
                        type="button"
                        role="radio"
                        aria-label={swatch.name}
                        aria-checked={selected}
                        tabIndex={selected ? 0 : -1}
                        onClick={() => setColor(swatch.value)}
                        className={cn(
                          'flex size-8 items-center justify-center rounded-lg',
                          'transition-colors duration-fast ease-out-quart motion-reduce:transition-none',
                          'hover:bg-[var(--chrome-hover,var(--color-panel))]',
                        )}
                      />
                    }
                  >
                    <span
                      className={cn(
                        'size-5 rounded-full border',
                        // The ring is what marks the choice here, as it does in
                        // the panel's grid — a swatch cannot show selection with
                        // a fill of its own.
                        selected &&
                          'ring-2 ring-ring ring-offset-2 ring-offset-panel',
                      )}
                      style={{
                        backgroundColor: swatch.value,
                        borderColor: swatchBorder(swatch.value),
                      }}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="top">{swatch.name}</TooltipContent>
                </Tooltip>
              );
            })}
          </div>

          {showSize ? (
            <>
              <span
                aria-hidden="true"
                className="mx-1 h-6 w-px shrink-0 bg-border/70"
              />
              <div
                role="radiogroup"
                aria-label="Stroke weight"
                onKeyDown={onSizeKeyDown}
                className="relative grid grid-cols-4"
              >
                {/* The chosen weight as a fill that slides across the four
                  segments — one moving mark rather than four chips lighting
                  up, which is what makes the row read as a single control.
                  Sized in percentages, not pixels, because a coarse pointer
                  grows every key here to 44px and a fixed width would strand
                  the mark half a key off. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute inset-y-0 left-0 w-1/4 rounded-lg border border-border-strong/60 bg-surface',
                    'transition-transform duration-base ease-out-quart motion-reduce:transition-none',
                    sizeIndex < 0 && 'opacity-0',
                  )}
                  style={{
                    transform: `translateX(${Math.max(sizeIndex, 0) * 100}%)`,
                  }}
                />
                {SIZE_OPTIONS.map((option, index) => {
                  const selected = option.value === size;
                  const dot = DOT_SIZES[index] ?? 8;
                  return (
                    <Tooltip key={option.name}>
                      <TooltipTrigger
                        render={
                          <button
                            ref={(node) => {
                              sizeRefs.current[index] = node;
                            }}
                            type="button"
                            role="radio"
                            aria-label={`${option.name}, ${option.value} pixels`}
                            aria-checked={selected}
                            tabIndex={selected ? 0 : -1}
                            onClick={() => setSize(option.value)}
                            className="relative z-10 flex size-8 items-center justify-center rounded-lg"
                          />
                        }
                      >
                        {/* Painted in the live ink color, so the row previews
                          both properties the bar carries at once. */}
                        <span
                          className="rounded-full border"
                          style={{
                            width: dot,
                            height: dot,
                            backgroundColor: color,
                            borderColor: swatchBorder(color),
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {option.name} — {option.value}px
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
              </div>
            </>
          ) : null}
        </Surface>
      </div>
    </div>
  );
}
