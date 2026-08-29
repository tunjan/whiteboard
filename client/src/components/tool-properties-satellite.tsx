import { useRef, useState } from 'react';
import {
  paletteColors,
  SIZE_OPTIONS,
  useStyleStore,
  type PaletteColor,
} from '@/canvas/use-style-store';
import { ToolbarDivider } from '@/components/toolbar/toolbar-constants';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
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
 * follows the theme the way every other swatch in the app does.
 *
 * Slot 0 is the ink swatch (black on the light canvas, white on the dark one),
 * then a spectrum — red, orange, yellow, green, blue, violet — and grey to
 * close it. Ordered by hue rather than by how often each is reached for,
 * because a row this long is scanned as a ramp: a swatch is found by where it
 * falls in the rainbow, and any other ordering makes that search fail.
 *
 * The remaining four are one click away behind the wheel, and the full set —
 * with fill, dash, opacity and type — stays in the style panel.
 */
const QUICK_SLOTS = [0, 11, 7, 6, 9, 5, 3, 1];

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
 * of acceleration at a size that reads inside a 36px target.
 */
const DOT_SIZES = [5, 7, 9, 11];

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

/** One swatch, drawn as the color itself with the selection carried by a ring. */
function Swatch({
  swatch,
  selected,
  onSelect,
  buttonRef,
}: {
  swatch: PaletteColor;
  selected: boolean;
  onSelect: () => void;
  buttonRef?: (node: HTMLButtonElement | null) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={buttonRef}
            type="button"
            role="radio"
            aria-label={swatch.name}
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={onSelect}
            className={cn(
              'flex size-7 items-center justify-center rounded-xl',
              'transition-colors duration-fast ease-out-quart motion-reduce:transition-none',
              'hover:bg-[var(--chrome-hover,var(--color-panel))]',
            )}
          />
        }
      >
        <span
          className={cn(
            'size-4 rounded-full border',
            // The ring is what marks the choice here, as it does in the panel's
            // grid — a swatch cannot show selection with a fill of its own.
            selected &&
              'ring-2 ring-tb-accent-ring ring-offset-1 ring-offset-surface',
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
}

/**
 * The rest of the palette, behind a colour wheel — the last key in the row, as
 * the ramp of quick colours runs out. It is the same twelve swatches the style
 * panel grids, offered here so a colour outside the quick four costs a click
 * rather than a trip across the screen.
 */
function ColorWheel({
  color,
  setColor,
}: {
  color: string;
  setColor: (color: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const colors = paletteColors(theme);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="More colors"
              className={cn(
                'flex size-7 items-center justify-center rounded-xl',
                'transition-colors duration-fast ease-out-quart motion-reduce:transition-none',
                'hover:bg-[var(--chrome-hover,var(--color-panel))]',
              )}
            />
          }
        >
          <span
            aria-hidden="true"
            className="size-4 rounded-full border border-border-strong/60"
            style={{
              backgroundImage:
                'conic-gradient(#e03131, #e16919, #f1ac4b, #4cb05e, #099268, #4ba1f1, #4465e9, #ae3ec9, #e03131)',
            }}
          />
        </TooltipTrigger>
        <TooltipContent side="top">More colors</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-auto p-1.5"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>Colors</PopoverTitle>
          <PopoverDescription>
            Pick a color from the full palette
          </PopoverDescription>
        </PopoverHeader>
        <div
          role="radiogroup"
          aria-label="All colors"
          className="grid grid-cols-4"
        >
          {colors.map((swatch) => (
            <Swatch
              key={swatch.value}
              swatch={swatch}
              selected={swatch.value === color}
              onSelect={() => {
                setColor(swatch.value);
                setOpen(false);
              }}
            />
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The active tool's two most-used properties — stroke weight, where the tool
 * has one, and colour — as a second bar floating just above the toolbar.
 *
 * It exists for the same reason the eraser's mode selector does: the setting
 * belongs to the tool, so it should land where the pointer already is instead
 * of costing a trip to the top-right style panel mid-stroke. That panel keeps
 * the full set — twelve swatches, fill, dash, opacity, type — and stays the
 * place a considered choice is made; this is the fast path for the choice made
 * a dozen times a minute.
 *
 * It is a bar in its own right, not a flange off the toolbar: same slab, same
 * corner, same shadow, separated from the toolbar by a real gap. Which means
 * the pair reads as two instruments stacked — what you are drawing with,
 * above what you are drawing with it — rather than as one tall control.
 *
 * Two things keep it tied to the bar under it despite that gap. It is narrower,
 * so it never squares up as an equal; and it left-aligns to the toolbar's
 * padding edge, which lands it over the tray whose instruments it configures.
 * Alignment is desktop-only: the compact bar is narrower than this pill, so
 * below `sm` it centres instead of hanging off the side of a phone screen.
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
  // switching to the select tool fades the pill out whole instead of dropping
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
        'absolute bottom-full mb-2.5 w-max',
        // `left-1.5` is the toolbar's own `p-1.5`, so the two left edges line
        // up exactly — a landmark on the bar rather than an offset from its
        // middle. Centred below `sm`, where this pill is wider than the
        // compact bar and would otherwise run off the screen.
        'left-1/2 -translate-x-1/2 sm:left-1.5 sm:translate-x-0',
        'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
        'motion-reduce:transition-none',
        active
          ? 'translate-y-0 opacity-100'
          : 'pointer-events-none translate-y-1.5 opacity-0',
      )}
    >
      <Surface
        mode="floating"
        chrome
        role="group"
        aria-label="Tool properties"
        className={cn(
          // `items-stretch` so the rules between the groups can run the full
          // depth of the pill; each group re-centres its own contents.
          'flex items-stretch rounded-toolbar py-1 px-1.5 [--tb-pad:0.25rem]',
          'border-transparent bg-surface tb-shell dark:border-border',
        )}
      >
        {showSize ? (
          <>
            <div
              role="radiogroup"
              aria-label="Stroke weight"
              onKeyDown={onSizeKeyDown}
              className="relative grid grid-cols-4 self-center rounded-2xl bg-tb-track"
            >
              {/* The chosen weight as a chip that slides across the four
                  segments of its recess — one moving mark rather than four
                  chips lighting up, which is what makes the row read as a
                  single control. Same recess and same flat chip as a group
                  of keys on the bar, so a selected weight and a selected tool
                  are marked the same way.

                  Inset on all four sides rather than filling the groove, so
                  the recess still reads as a groove with something sitting in
                  it. That inset is what the travel has to account for: the
                  mark is a segment less the two insets, so one step along is
                  its own width plus the gap it leaves, not a flat 100%. Widths
                  stay in percentages because a coarse pointer grows every key
                  here to 44px, and a fixed one would strand the mark half a
                  key off. */}
              <span
                aria-hidden="true"
                className={cn(
                  'pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc(25%-6px)] rounded-[13px] bg-tb-accent',
                  'transition-transform duration-base ease-out-quart motion-reduce:transition-none',
                  sizeIndex < 0 && 'opacity-0',
                )}
                style={{
                  transform: `translateX(calc(${Math.max(sizeIndex, 0)} * (100% + 6px)))`,
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
                          className="relative z-10 flex size-9 items-center justify-center rounded-xl"
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

            <ToolbarDivider />
          </>
        ) : null}

        {/* The wheel closes the ramp inside the colour group rather than
            standing behind a rule of its own: it is where the ramp runs out,
            not a fifth thing the pill does. */}
        <div className="flex items-center self-center">
          <div
            role="radiogroup"
            aria-label="Color"
            onKeyDown={onSwatchKeyDown}
            className="flex items-center"
          >
            {swatches.map((swatch, index) => (
              <Swatch
                key={swatch.value}
                swatch={swatch}
                selected={swatch.value === color}
                onSelect={() => setColor(swatch.value)}
                buttonRef={(node) => {
                  swatchRefs.current[index] = node;
                }}
              />
            ))}
          </div>

          <ColorWheel color={color} setColor={setColor} />
        </div>
      </Surface>
    </div>
  );
}
