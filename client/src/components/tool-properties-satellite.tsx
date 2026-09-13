import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';

const QUICK_SLOTS = [0, 11, 7, 6, 9, 5, 3, 1];

const DOT_SIZES = [6, 10, 14, 18];

const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

const POPOVER = 'lg lg-card w-52 gap-2 border-0 p-2';
const ROW = 'w-full';
/**
 * An option inside one. `lg-option` is what marks the chosen one as the
 * inverted fill the bar uses, rather than the `bg-panel` `toggleVariants`
 * brings.
 */
const ITEM = 'lg-option grow basis-0';

export function quickSwatches(
  colors: PaletteColor[],
  color: string,
): PaletteColor[] {
  const quick = QUICK_SLOTS.flatMap((slot) => colors[slot] ?? []);
  return quick.some((c) => c.value === color)
    ? quick
    : [...quick, { name: 'Current color', value: color }];
}

function Plated({ children, className, ...rest }: React.ComponentProps<'div'>) {
  return (
    <div
      {...rest}
      data-style-lobe=""
      className={cn('style-control-group relative self-center', className)}
    >
      <span aria-hidden="true" className="style-group-plate" />
      {children}
    </div>
  );
}

/** Follow the actual groups, including the shorter bars and extra colors. */
function StylePlate() {
  const ref = useRef<SVGSVGElement>(null);
  const id = useId();
  const [outline, setOutline] = useState({ path: '', width: 1, height: 1 });

  useLayoutEffect(() => {
    const svg = ref.current;
    const bar = svg?.parentElement;
    if (!bar) return;
    const measure = () => {
      const bounds = bar.getBoundingClientRect();
      const height = bar.offsetHeight;
      const radius = height / 2;
      const groups = Array.from(
        bar.querySelectorAll<HTMLElement>('[data-style-lobe]'),
      );
      if (!groups.length || !bounds.width) return;
      // Compensate for the entrance animation's scale, and preserve the full
      // silhouette while the narrow-screen viewport scrolls across it.
      const scale = bounds.width / bar.offsetWidth;
      const lobes = groups.map((group) => {
        const box = group.getBoundingClientRect();
        return {
          left: (box.left - bounds.left) / scale + bar.scrollLeft - 8,
          right: (box.right - bounds.left) / scale + bar.scrollLeft + 8,
        };
      });
      const first = lobes[0]!;
      const last = lobes[lobes.length - 1]!;
      const edge = (bottom: boolean) => {
        const y = bottom ? height : 0;
        const neck = bottom ? height * 0.76 : height * 0.24;
        const ordered = bottom ? [...lobes].reverse() : lobes;
        const direction = bottom ? -1 : 1;
        return ordered
          .map((lobe, index) => {
            const end = bottom ? lobe.left + radius : lobe.right - radius;
            const next = ordered[index + 1];
            if (!next) return `L${end},${y}`;
            const start = bottom ? next.right - radius : next.left + radius;
            const middle = (end + start) / 2;
            const shoulder = radius * 0.6875;
            const waist = radius * 0.3125;
            return `L${end},${y} C${end + direction * shoulder},${y} ${middle - direction * waist},${neck} ${middle},${neck} S${start - direction * shoulder},${y} ${start},${y}`;
          })
          .join(' ');
      };
      const path = `M${first.left + radius},0 ${edge(false)} A${radius},${radius} 0 0 1 ${last.right - radius},${height} ${edge(true)} A${radius},${radius} 0 0 1 ${first.left + radius},0 Z`;
      const width = last.right + first.left;
      setOutline((previous) =>
        previous.path === path && previous.width === width
          ? previous
          : { path, width, height },
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    bar
      .querySelectorAll('[data-style-lobe]')
      .forEach((group) => observer.observe(group));
    measure();
    return () => observer.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      aria-hidden="true"
      className="style-plate"
      width={outline.width}
      height={outline.height}
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop className="tb-plate-top" />
          <stop offset="1" className="tb-plate-bottom" />
        </linearGradient>
      </defs>
      <path d={outline.path} fill={`url(#${id})`} />
    </svg>
  );
}

function SelectionChip({ index, count }: { index: number; count: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'tb-mark lg-travel pointer-events-none absolute inset-y-[3px] left-[3px] rounded-full',
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

function useCloseWithBar(visible: boolean, close: (open: boolean) => void) {
  useEffect(() => {
    if (!visible) close(false);
  }, [visible]);
}

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
              'lg-key relative z-10 flex size-9 items-center justify-center rounded-full',
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
            className="style-swatch relative z-10 size-5 rounded-full border"
            style={{
              backgroundColor: swatch.value,
              borderColor: swatchBorder(swatch.value),
              boxShadow: selected
                ? '0 0 0 2.5px var(--bg-surface), 0 0 0 4px var(--border-strong)'
                : undefined,
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
              data-style-lobe=""
              className={cn(
                'style-wheel-key lg lg-key lg-pill relative flex size-9 items-center justify-center',
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
              className="style-color-wheel relative z-10 size-5 rounded-full"
              style={{
                backgroundImage:
                  'conic-gradient(#ff2857, #ff8b18, #ffe438, #7bd94b, #00bdd3, #3264ff, #b52fff, #ff2857)',
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
                'tb-key lg-key group/key relative flex size-9 items-center justify-center rounded-full active:scale-95 motion-reduce:active:scale-100',
                open ? 'text-fg' : 'text-fg-muted hover:text-fg',
              )}
            />
          }
        >
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
    <Plated
      role="radiogroup"
      aria-label="Stroke weight"
      onKeyDown={onKeyDown}
      className="grid shrink-0 grid-cols-4"
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
    </Plated>
  );
}

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
    <Plated
      role="radiogroup"
      aria-label="Eraser mode"
      onKeyDown={onKeyDown}
      className="grid shrink-0 grid-cols-2"
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
    </Plated>
  );
}

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

  return (
    <div className="style-color-section flex shrink-0 items-center self-center">
      <Plated
        role="radiogroup"
        aria-label="Color"
        onKeyDown={onKeyDown}
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${swatches.length}, minmax(0, 1fr))`,
        }}
      >
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
      </Plated>
      <ColorWheel color={color} setColor={onSelect} barVisible={barVisible} />
    </div>
  );
}

export function ToolPropertiesSatellite({
  activeToolId,
}: {
  activeToolId: string;
}) {
  const { visible, show, values, apply } = useStyleControls(activeToolId);

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
        preview={
          values.fill === 'none' ? (
            <span aria-hidden="true" className="style-no-fill" />
          ) : (
            <FillPreview style={values.fill} />
          )
        }
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
        <Plated className="style-detail-group flex shrink-0">{keys}</Plated>
      ),
    });
  }

  return (
    <div
      aria-hidden={!visible}
      inert={!visible}
      data-visible={visible}
      className={cn(
        'absolute bottom-full mb-2 w-max max-w-[calc(100vw-1rem)]',
        'left-1/2 -translate-x-1/2',
        'style-bar-motion',
      )}
    >
      <Surface
        mode="floating"
        chrome
        role="group"
        aria-label="Style controls"
        className={cn(
          'border-0 bg-transparent shadow-none',
          'style-reference relative isolate flex items-center',
          'max-sm:overflow-x-auto max-sm:overflow-y-hidden max-sm:py-2',
          'max-sm:[scrollbar-width:none] max-sm:[&::-webkit-scrollbar]:hidden',
        )}
      >
        <StylePlate key={sections.map((section) => section.id).join('-')} />
        {sections.map((section) => (
          <Fragment key={section.id}>{section.node}</Fragment>
        ))}
      </Surface>
    </div>
  );
}
