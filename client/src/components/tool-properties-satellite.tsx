import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  LineSpline,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { fontStack } from '@/canvas/shapes/text-measure';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { useStyleControls } from '@/canvas/use-style-controls';
import {
  paletteColors,
  SIZE_OPTIONS,
  type PaletteColor,
} from '@/canvas/use-style-store';
import { OpacitySlider } from '@/components/opacity-slider';
import {
  ALIGNS,
  ARROW_TOPOLOGIES,
  DASHES,
  ERASER_MODES,
  DASH_LABELS,
  DashPreview,
  FILLS,
  FILL_LABELS,
  FONTS,
  FillPreview,
  OpacityPreview,
  SPLINES,
  SPLINE_LABELS,
  SplinePreview,
  WEIGHTS,
} from '@/components/style-previews';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { CHROME_ON_BOARD, Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
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
 * The remaining four are one click away behind the wheel that closes the row.
 */
const QUICK_SLOTS = [0, 11, 7, 6, 9, 5, 3, 1];

/**
 * Dot diameters for the four stroke presets. Deliberately not the world-unit
 * widths: those run 2→10, and a ramp that literal either starts invisible or
 * ends wider than the key it sits in. These preserve the ordering and the sense
 * of acceleration at a size that reads inside a 36px target.
 */
const DOT_SIZES = [5, 7, 9, 11];

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

/**
 * Every popover on the bar opens at one width, so the set reads as one control
 * shown several ways rather than as six differently-shaped menus. It is also
 * what lets the option rows inside divide evenly, the way the panel's did.
 *
 * The same plate as the capsules that open them. `border-0` drops the
 * popover's own hairline, since `.lg` states the edge for the whole family and
 * a border over it reads as two.
 */
const POPOVER = 'lg lg-card w-52 gap-2 border-0 p-2';
const ROW = 'w-full';
/**
 * An option inside one. `lg-option` is what marks the chosen one as the
 * inverted fill the bar uses, rather than the `bg-panel` `toggleVariants`
 * brings.
 */
const ITEM = 'lg-option grow basis-0';

/**
 * The quick slots under `colors`, plus the live color when it is not one of
 * them. Same rule as the old panel's grid: a swatch row with nothing selected
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

/**
 * The selection chip: one fill sliding under the chosen segment of a capsule,
 * rather than a segment lighting up.
 *
 * It is inset on all four sides, so the capsule still reads as a track with
 * something in it. That inset is what the travel has to account for: the chip
 * is a segment less the two insets, so one step along is its own width plus the
 * gap it leaves, not a flat 100%. Both stay percentages of the track, because a
 * coarse pointer grows every key here to 44px and a chip sized in fixed pixels
 * would then sit half a key off.
 *
 * Shared by the three capsules on this bar — weight, colour, eraser mode — so
 * the mark cannot come to mean one thing in one of them and something else in
 * the next.
 */
function SelectionChip({ index, count }: { index: number; count: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'lg-chip lg-travel pointer-events-none absolute inset-y-[3px] left-[3px] rounded-full',
        index < 0 && 'opacity-0',
      )}
      style={{
        width: `calc(${100 / count}% - 6px)`,
        transform: `translateX(calc(${Math.max(index, 0)} * (100% + 6px)))`,
      }}
    />
  );
}

/** −1 for a backwards arrow, 1 for a forwards one, 0 for anything else. */
function arrowDelta(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

/**
 * Shuts a popover when the bar it hangs off goes away.
 *
 * The bar hides itself with opacity and `inert`, but a popover is portalled
 * out of that subtree — so one left open when the tool changes under a hotkey
 * would sit on the canvas with nothing under it to explain what it belongs to.
 */
function useCloseWithBar(visible: boolean, close: (open: boolean) => void) {
  useEffect(() => {
    if (!visible) close(false);
  }, [visible]);
}

/**
 * One swatch, drawn as the color itself.
 *
 * The selection is the chip, not a ring: in the ramp capsule it slides
 * under the chosen swatch from wherever it was, and in the wheel's grid — where
 * a slide between two rows would mean nothing — it simply stands under it
 * (`chip`). The ring this used to wear was how a swatch showed its state with no
 * ground to change; with a ground, a ring over the chip is the state said twice.
 *
 * `relative z-10` because the capsule's lens and rim are positioned layers, and
 * a static child of one would paint behind them.
 */
function Swatch({
  swatch,
  selected,
  chip = false,
  onSelect,
  buttonRef,
}: {
  swatch: PaletteColor;
  selected: boolean;
  /** Carry the chip on this swatch, for a grid the sliding one cannot serve. */
  chip?: boolean;
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
              'lg-key relative z-10 flex size-7 items-center justify-center rounded-full',
              'transition-transform duration-fast ease-out-quart motion-reduce:transition-none',
              'active:scale-95',
            )}
          />
        }
      >
        <>
          <span
            aria-hidden="true"
            className={cn(
              'lg-wash pointer-events-none absolute inset-[3px] rounded-full',
              chip && selected && 'lg-chip',
            )}
          />
          <span
            className="relative z-10 size-4 rounded-full border"
            style={{
              backgroundColor: swatch.value,
              borderColor: swatchBorder(swatch.value),
            }}
          />
        </>
      </TooltipTrigger>
      <TooltipContent side="top">{swatch.name}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The rest of the palette, behind a colour wheel — the last key in the row, as
 * the ramp of quick colours runs out. All twelve swatches, so a colour outside
 * the quick eight costs a click rather than a trip across the screen.
 */
function ColorWheel({
  color,
  setColor,
  barVisible,
}: {
  color: string;
  setColor: (color: string) => void;
  barVisible: boolean;
}) {
  const [open, setOpen] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const colors = paletteColors(theme);

  useCloseWithBar(barVisible, setOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label="More colors"
              className={cn(
                // Its own round capsule beside the ramp rather than a
                // ninth column inside it: it opens something instead of
                // choosing something, so it is not a segment the chip can land
                'lg lg-key lg-pill relative flex size-7 items-center justify-center',
                'transition-transform duration-fast ease-out-quart motion-reduce:transition-none',
                'active:scale-95',
              )}
            />
          }
        >
          <>
            <span
              aria-hidden="true"
              className="lg-wash pointer-events-none absolute inset-[3px] rounded-full"
            />
            <span
              aria-hidden="true"
              className="relative z-10 size-4 rounded-full"
              style={{
                backgroundImage:
                  'conic-gradient(#e03131, #e16919, #f1ac4b, #4cb05e, #099268, #4ba1f1, #4465e9, #ae3ec9, #e03131)',
              }}
            />
          </>
        </TooltipTrigger>
        <TooltipContent side="top">More colors</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="lg lg-card w-auto border-0 p-1.5"
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
          // No sliding chip here: the chip reads as one object moving along a
          // line, and it has nothing to say about a jump between two rows of a
          // grid. The chosen swatch carries the chip standing still instead.
          className="grid grid-cols-4"
        >
          {colors.map((swatch) => (
            <Swatch
              key={swatch.value}
              swatch={swatch}
              selected={swatch.value === color}
              chip
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
 * One property that does not earn a permanent seat on the bar: a key that
 * shows the value it currently holds, and opens the choices over it.
 *
 * A key rather than a row, because the bar has to stay one line at any width
 * and the pointer is already here — a click that lands the options directly
 * above the toolbar beats a row that pushes half the bar off a phone screen.
 * The preview is what keeps the click honest: the current fill, dash, amount
 * or typeface is legible without opening anything, so the key is only pressed
 * when the value is actually being changed.
 *
 * Open is marked the way every other chosen thing in this set is: the
 * chip, standing under the key rather than sliding — these keys open things
 * rather than choosing between each other, so there is no line for a chip to
 * travel along and at most one of them is ever open.
 */
function StyleKey({
  label,
  hint,
  preview,
  barVisible,
  children,
}: {
  label: string;
  hint: string;
  preview: ReactNode;
  barVisible: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useCloseWithBar(barVisible, setOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              aria-label={label}
              className={cn(
                // No `tb-glyph`: the halo is what carries a glyph that has
                // nothing under it, and this one is standing on a plate now.
                // Two grounds is a smudge, not twice the legibility.
                'tb-key lg-key group/key relative flex size-9 items-center justify-center rounded-full active:scale-95 motion-reduce:active:scale-100',
                open ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            />
          }
        >
          {/* The chip is a layer inset into the key, not the key's own
              background: inset by 3 on every side, the same as the sliding chips
              in the capsules beside it, so the plate it stands on still shows
              around it and its specular rim never lands on the capsule's own.
              Rounded full rather than to a radius, because the capsule holding
              these keys is a pill — a concentric inset of a pill is a pill. */}
          <span
            aria-hidden="true"
            className={cn(
              'lg-wash pointer-events-none absolute inset-[3px] rounded-full',
              open && 'lg-chip',
            )}
          />
          <span className="relative z-10 flex items-center justify-center">
            {preview}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className={POPOVER}
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>{hint}</PopoverDescription>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

/**
 * Stroke weight: four segments of one capsule, with the chip sliding
 * between them — one moving mark rather than four lights taking turns, which is
 * what makes the row read as a single control. Geometry and travel live in
 * `SelectionChip`, which the colour ramp and the eraser switch share.
 */
function StrokeWeight({
  size,
  color,
  onSelect,
}: {
  size: number;
  color: string;
  onSelect: (value: number) => void;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = SIZE_OPTIONS.findIndex((option) => option.value === size);

  // Radiogroup convention, as everywhere else in this stack: an arrow moves
  // the choice, and focus follows it.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    const from = index < 0 ? 0 : index;
    const next =
      (from + arrowDelta(event.key) + SIZE_OPTIONS.length) %
      SIZE_OPTIONS.length;
    const option = SIZE_OPTIONS[next];
    if (!option) return;
    onSelect(option.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Stroke weight"
      onKeyDown={onKeyDown}
      className="lg lg-pill relative grid shrink-0 grid-cols-4 self-center"
    >
      <SelectionChip index={index} count={SIZE_OPTIONS.length} />
      {SIZE_OPTIONS.map((option, i) => (
        <Tooltip key={option.name}>
          <TooltipTrigger
            render={
              <button
                ref={(node) => {
                  refs.current[i] = node;
                }}
                type="button"
                role="radio"
                aria-label={`${option.name}, ${option.value} pixels`}
                aria-checked={option.value === size}
                tabIndex={option.value === size ? 0 : -1}
                onClick={() => onSelect(option.value)}
                className="lg-key relative z-10 flex size-9 items-center justify-center rounded-full"
              />
            }
          >
            <span
              aria-hidden="true"
              className="lg-wash pointer-events-none absolute inset-[3px] rounded-full"
            />
            {/* Painted in the live ink color, so the row previews both of the
                bar's permanent properties at once. */}
            <span
              className="relative z-10 rounded-full border"
              style={{
                width: DOT_SIZES[i] ?? 8,
                height: DOT_SIZES[i] ?? 8,
                backgroundColor: color,
                borderColor: swatchBorder(color),
              }}
            />
          </TooltipTrigger>
          <TooltipContent side="top">
            {option.name} — {option.value}px
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * The eraser's two modes, built exactly like the stroke weight above it: a
 * chip that slides between the segments of one capsule, so the pair reads
 * as a single switch rather than two lights.
 *
 * It rides on this bar rather than on the eraser's own button because it is
 * what the eraser is set to, and every other tool's settings are found here.
 * The eraser's bar carries nothing else — it paints no colour and no weight —
 * so the switch is the whole of it.
 */
function EraserModeSwitch() {
  const eraserMode = useCanvasUiStore((s) => s.eraserMode);
  const setEraserMode = useCanvasUiStore((s) => s.setEraserMode);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = ERASER_MODES.findIndex(({ mode }) => mode === eraserMode);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!ARROW_KEYS.includes(event.key)) return;
    event.preventDefault();
    const from = index < 0 ? 0 : index;
    const next =
      (from + arrowDelta(event.key) + ERASER_MODES.length) %
      ERASER_MODES.length;
    const option = ERASER_MODES[next];
    if (!option) return;
    setEraserMode(option.mode);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Eraser mode"
      onKeyDown={onKeyDown}
      className="lg lg-pill relative grid shrink-0 grid-cols-2 self-center"
    >
      <SelectionChip index={index} count={ERASER_MODES.length} />
      {ERASER_MODES.map(({ mode, label, Preview }, i) => {
        const selected = mode === eraserMode;
        return (
          <Tooltip key={mode}>
            <TooltipTrigger
              render={
                <button
                  ref={(node) => {
                    refs.current[i] = node;
                  }}
                  type="button"
                  role="radio"
                  aria-label={label}
                  aria-checked={selected}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setEraserMode(mode)}
                  className={cn(
                    'lg-key relative z-10 flex size-9 items-center justify-center rounded-full',
                    'transition-colors duration-fast ease-out-quart motion-reduce:transition-none',
                    selected ? 'text-fg' : 'text-fg-muted hover:text-fg',
                  )}
                />
              }
            >
              <span
                aria-hidden="true"
                className="lg-wash pointer-events-none absolute inset-[3px] rounded-full"
              />
              <span className="relative z-10 flex items-center justify-center">
                <Preview />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}

/**
 * The eight quick colours as a ramp, closed by the wheel holding the rest.
 *
 * One capsule holding the swatches, with the chip sliding under the chosen
 * one — the same capsule and the same chip as the stroke weights, because
 * picking a colour and picking a weight are the same kind of choice and a row
 * this long is read as a ramp either way. A grid rather than a flex row so the
 * segments divide evenly whatever the pointer has grown them to, which is what
 * the chip's travel is measured in.
 */
function ColorRamp({
  color,
  onSelect,
  barVisible,
}: {
  color: string;
  onSelect: (value: string) => void;
  barVisible: boolean;
}) {
  const theme = useThemeStore((s) => s.theme);
  const swatches = quickSwatches(paletteColors(theme), color);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = swatches.findIndex((swatch) => swatch.value === color);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    const index = refs.current.indexOf(event.target as HTMLButtonElement);
    const next = (index + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    onSelect(swatch.value);
    refs.current[next]?.focus();
  };

  // The wheel closes the ramp inside the colour group rather than standing
  // behind a rule of its own: it is where the ramp runs out, not a separate
  // thing the bar does. It sits just outside the capsule rather than as a last
  // segment of it, because it opens something instead of choosing something —
  // the chip must never be able to land on it.
  return (
    <div className="flex shrink-0 items-center gap-1 self-center">
      <div
        role="radiogroup"
        aria-label="Color"
        onKeyDown={onKeyDown}
        className="lg lg-pill relative grid self-center"
        style={{
          gridTemplateColumns: `repeat(${swatches.length}, minmax(0, 1fr))`,
        }}
      >
        <SelectionChip index={index} count={swatches.length} />
        {swatches.map((swatch, position) => (
          <Swatch
            key={swatch.value}
            swatch={swatch}
            selected={swatch.value === color}
            onSelect={() => onSelect(swatch.value)}
            buttonRef={(node) => {
              refs.current[position] = node;
            }}
          />
        ))}
      </div>
      <ColorWheel color={color} setColor={onSelect} barVisible={barVisible} />
    </div>
  );
}

/**
 * Every style control the board has, as a second bar floating just above the
 * toolbar.
 *
 * It replaces the top-right style panel outright. The settings belong to what
 * the pointer is holding or has picked up, so they should land where the
 * pointer already is instead of costing a trip across the screen mid-stroke —
 * the same reason the eraser's mode selector rides on the eraser.
 *
 * A bar cannot hold eleven groups of controls in a line, so the two reached
 * for constantly stay out on it — stroke weight and colour, no click at all —
 * and the rest collapse into keys that each show their current value and open
 * their choices over the bar. What is left is one row at any width, where the
 * cost of a property is either zero clicks or one, and never a hunt.
 *
 * It is a bar in its own right, not a flange off the toolbar: same slab, same
 * corner, same shadow, separated from the toolbar by a real gap. Which means
 * the pair reads as two instruments stacked — what you are drawing with, above
 * what you are drawing with it — rather than as one tall control.
 *
 * Two things keep it tied to the bar under it despite that gap. It is shorter,
 * so it never squares up as an equal; and it left-aligns to the toolbar's
 * padding edge, which lands it over the tray whose instruments it configures.
 * Alignment is desktop-only: below `sm` the compact bar is the narrower of the
 * two, so this one centres and scrolls within the screen instead of hanging
 * off the side of a phone.
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
  const { visible, show, values, apply } = useStyleControls(activeToolId);

  // Which set of controls to draw. Pinned to the last one that had any, so
  // clearing the selection fades the pill out whole instead of dropping half
  // its keys on the first frame of the close.
  const shown = useRef(show);
  if (visible) shown.current = show;
  const on = shown.current;

  const keys: ReactNode[] = [];
  if (on.fill) {
    keys.push(
      <StyleKey
        key="fill"
        barVisible={visible}
        label="Fill"
        hint="Choose how the shape's interior is painted"
        preview={<FillPreview style={values.fill} />}
      >
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Fill style"
          value={[values.fill]}
          onValueChange={(v) => v[0] && apply.fill(v[0] as FillStyle)}
        >
          {FILLS.map((fillStyle) => (
            <ToggleGroupItem
              key={fillStyle}
              className={ITEM}
              value={fillStyle}
              aria-label={FILL_LABELS[fillStyle]}
            >
              <FillPreview style={fillStyle} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </StyleKey>,
    );
  }
  if (on.dash) {
    keys.push(
      <StyleKey
        key="dash"
        barVisible={visible}
        label="Stroke style"
        hint="Choose how the outline is drawn"
        preview={<DashPreview dash={values.dash} />}
      >
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Stroke style"
          value={[values.dash]}
          onValueChange={(v) => v[0] && apply.dash(v[0] as StrokeDash)}
        >
          {DASHES.map((strokeDash) => (
            <ToggleGroupItem
              key={strokeDash}
              className={ITEM}
              value={strokeDash}
              aria-label={DASH_LABELS[strokeDash]}
            >
              <DashPreview dash={strokeDash} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </StyleKey>,
    );
  }
  if (on.opacity) {
    keys.push(
      <StyleKey
        key="opacity"
        barVisible={visible}
        label="Opacity"
        hint="Set how solid this is"
        preview={<OpacityPreview value={values.opacity} />}
      >
        <div className="flex items-center gap-2 px-1">
          <OpacitySlider
            aria-label="Opacity"
            value={values.opacity}
            onValueChange={apply.opacity}
          />
          {/* Tabular, so the fader does not shuffle its own label sideways
              as it passes 9%, 99%. */}
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-fg-muted">
            {Math.round(values.opacity * 100)}%
          </span>
        </div>
      </StyleKey>,
    );
  }
  if (on.font) {
    keys.push(
      <StyleKey
        key="text"
        barVisible={visible}
        label="Text"
        hint="Set the typeface, weight and alignment"
        preview={
          <span
            aria-hidden="true"
            className="text-sm leading-none"
            style={{
              fontFamily: fontStack(values.fontFamily),
              fontWeight: values.fontWeight,
            }}
          >
            Aa
          </span>
        }
      >
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Typeface"
          value={[values.fontFamily]}
          onValueChange={(v) => v[0] && apply.fontFamily(v[0] as FontFamily)}
        >
          {FONTS.map(({ family, label }) => (
            <ToggleGroupItem
              key={family}
              className={ITEM}
              value={family}
              aria-label={`${family} typeface`}
              style={{ fontFamily: fontStack(family) }}
            >
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Font weight"
          value={[String(values.fontWeight)]}
          onValueChange={(v) =>
            v[0] && apply.fontWeight(Number(v[0]) as FontWeight)
          }
        >
          {WEIGHTS.map(({ weight, label }) => (
            <ToggleGroupItem
              key={weight}
              className={ITEM}
              value={String(weight)}
              aria-label={`${label} weight`}
              // Preview each option in the weight it applies, using the
              // typeface currently selected.
              style={{
                fontFamily: fontStack(values.fontFamily),
                fontWeight: weight,
              }}
            >
              A
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {on.align ? (
          <ToggleGroup
            className={ROW}
            spacing={1.5}
            aria-label="Text alignment"
            value={[values.align]}
            onValueChange={(v) => v[0] && apply.align(v[0] as TextAlign)}
          >
            {ALIGNS.map(({ align, Icon }) => (
              <ToggleGroupItem
                key={align}
                className={ITEM}
                value={align}
                aria-label={`${align} alignment`}
              >
                <Icon aria-hidden="true" />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </StyleKey>,
    );
  }
  if (on.arrows) {
    keys.push(
      <StyleKey
        key="arrow"
        barVisible={visible}
        label="Arrow"
        hint="Set the route, the arrowheads and the label"
        preview={
          <span aria-hidden="true" className="text-base leading-none">
            {
              ARROW_TOPOLOGIES.find((t) => t.value === values.arrowTopology)
                ?.glyph
            }
          </span>
        }
      >
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Arrow route"
          value={[values.arrowTopology]}
          onValueChange={(v) =>
            v[0] && apply.arrowTopology(v[0] as ArrowTopology)
          }
        >
          {ARROW_TOPOLOGIES.map((option) => (
            <ToggleGroupItem
              key={option.value}
              className={ITEM}
              value={option.value}
              aria-label={option.label}
            >
              <span className="text-base leading-none" aria-hidden="true">
                {option.glyph}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          multiple
          aria-label="Arrowheads"
          value={[
            ...(values.arrowStart ? ['start'] : []),
            ...(values.arrowEnd ? ['end'] : []),
          ]}
          onValueChange={(v) => {
            apply.arrowStart(v.includes('start'));
            apply.arrowEnd(v.includes('end'));
          }}
        >
          <ToggleGroupItem
            className={ITEM}
            value="start"
            aria-label="Arrowhead at start"
          >
            <ArrowLeft aria-hidden="true" />
          </ToggleGroupItem>
          <ToggleGroupItem
            className={ITEM}
            value="end"
            aria-label="Arrowhead at end"
          >
            <ArrowRight aria-hidden="true" />
          </ToggleGroupItem>
        </ToggleGroup>
        {on.connectorLabel ? (
          <Input
            aria-label="Connector label"
            placeholder="Label"
            value={values.connectorLabel}
            onChange={(event) => apply.connectorLabel(event.target.value)}
          />
        ) : null}
      </StyleKey>,
    );
  }
  if (on.lineOptions) {
    keys.push(
      <StyleKey
        key="line"
        barVisible={visible}
        label="Line"
        hint="Set how the line runs through its points, and its label"
        preview={<SplinePreview spline={values.lineSpline} />}
      >
        <ToggleGroup
          className={ROW}
          spacing={1.5}
          aria-label="Line interpolation"
          value={[values.lineSpline]}
          onValueChange={(v) => v[0] && apply.lineSpline(v[0] as LineSpline)}
        >
          {SPLINES.map((spline) => (
            <ToggleGroupItem
              key={spline}
              className={ITEM}
              value={spline}
              aria-label={SPLINE_LABELS[spline]}
            >
              <SplinePreview spline={spline} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {on.connectorLabel ? (
          <Input
            aria-label="Connector label"
            placeholder="Label"
            value={values.connectorLabel}
            onChange={(event) => apply.connectorLabel(event.target.value)}
          />
        ) : null}
      </StyleKey>,
    );
  }

  // Laid out as sections, unruled — the pill's own gap between them is enough
  // to separate the groups without another line of chrome.
  const sections: { id: string; node: ReactNode }[] = [];
  if (on.eraserMode) {
    sections.push({ id: 'eraser-mode', node: <EraserModeSwitch /> });
  }
  if (on.size) {
    sections.push({
      id: 'size',
      node: (
        <StrokeWeight
          size={values.size}
          color={values.color}
          onSelect={apply.size}
        />
      ),
    });
  }
  if (on.color) {
    sections.push({
      id: 'color',
      node: (
        <ColorRamp
          color={values.color}
          onSelect={apply.color}
          barVisible={visible}
        />
      ),
    });
  }
  if (keys.length > 0) {
    sections.push({
      id: 'keys',
      node: (
        // Flush in its capsule rather than padded like a toolbar group: the
        // padded version stands 52px tall, which is the toolbar's own height,
        // and the satellite has to stay the shorter of the two. A 36px key in a
        // pill of the same height is concentric by construction, which is what
        // the old 16px recess needed a stepped-down radius to fake.
        <div className="lg lg-pill relative flex shrink-0 self-center">
          {keys}
        </div>
      ),
    });
  }

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      // The rise and the fade live in `.style-bar-motion` rather than in
      // utilities here. They have to read the `translate` the centring below
      // writes, and a transition that spans both channels is a rule, not a
      // class list.
      data-visible={visible}
      className={cn(
        'absolute bottom-full mb-3.5 w-max max-w-[calc(100vw-1rem)]',
        // `left-1.5` is the toolbar's own `p-1.5`, so the two left edges line
        // up exactly — a landmark on the bar rather than an offset from its
        // middle. Centred below `sm`, where this pill can outgrow the compact
        // bar and would otherwise run off the screen.
        'left-1/2 -translate-x-1/2 sm:left-1.5 sm:translate-x-0',
        'style-bar-motion',
      )}
    >
      <Surface
        mode="floating"
        chrome
        role="group"
        aria-label="Style controls"
        className={cn(
          // `items-stretch` so the rules between the sections can run the full
          // depth of the pill; each section re-centres its own contents.
          // Round, and with no card, like the bar it rides on: the two are
          // one piece of chrome seen at two heights, so they cannot round or
          // fill by different rules. What is left of the pill is its
          // contents — the washes under the switches, and the glyphs.
          'flex items-stretch gap-1 rounded-full py-1 px-1.5 [--tb-pad:0.25rem]',
          // Below `sm` a wide subject (mixed selection, an arrow) can outrun a
          // phone's width, so the bar scrolls rather than reaching past the
          // screen. `overflow-y-hidden` is what keeps that from also opening a
          // vertical scroller for the 4px the rules bleed into the padding.
          'max-sm:overflow-x-auto max-sm:overflow-y-hidden',
          'max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden',
          CHROME_ON_BOARD,
        )}
      >
        {sections.map((section) => (
          <Fragment key={section.id}>{section.node}</Fragment>
        ))}
      </Surface>
    </div>
  );
}
