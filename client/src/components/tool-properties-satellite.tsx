import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  MoveHorizontal,
  SlidersHorizontal,
} from 'lucide-react';
import type { ArrowTopology, FontFamily } from '@whiteboard/shared';
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
  DASH_LABELS,
  DashPreview,
  ERASER_MODES,
  FILLS,
  FILL_LABELS,
  FONTS,
  FillPreview,
  SPLINES,
  SPLINE_LABELS,
  SplinePreview,
  WEIGHTS,
} from '@/components/style-previews';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  ToolbarItem,
  ToolbarSurface,
} from '@/components/toolbar/toolbar-primitives';
import { StickerStrip } from '@/components/toolbar/toolbar-sticker-strip';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';

/**
 * The active tool's properties, on a plate above the toolbar.
 *
 * Three zones, each a different kind of control, so each reads as what it is
 * without a label: a ramp of colour dots, a segmented row of stroke weights,
 * and one key that opens everything else. The two things reached for on every
 * stroke are one click away; the rest is one click further.
 *
 * Two marks, and they never swap: a *value* in a row is a neutral pill that
 * slides to it, and the chosen colour wears a ring. Blue is the toolbar's —
 * it marks the tool, not its settings.
 */

const QUICK_SLOTS = [0, 11, 7, 6, 9, 5, 3, 1];

/** Sample-stroke thickness for each weight, at chrome scale. */
const WEIGHT_STROKES = [2, 4, 7, 11];
const WEIGHT_NAMES: Record<string, string> = {
  S: 'Small',
  M: 'Medium',
  L: 'Large',
  XL: 'Extra large',
};

const FONT_NAMES: Record<FontFamily, string> = {
  sans: 'Sans',
  serif: 'Serif',
  mono: 'Mono',
  hand: 'Handwritten',
};

/** Each route drawn as the path it takes, at the Stroke row's size. */
const ROUTE_PATHS: Record<ArrowTopology, string> = {
  straight: 'M2 6 H20',
  arc: 'M2 9 Q11 -1 20 9',
  elbow: 'M2 3 V9 H20',
};

function RoutePreview({ route }: { route: ArrowTopology }) {
  return (
    <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
      <path
        d={ROUTE_PATHS[route]}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type Ends = 'none' | 'start' | 'end' | 'both';

const ENDS: { value: Ends; label: string; glyph: ReactNode }[] = [
  { value: 'none', label: 'No arrowheads', glyph: <Minus size={16} /> },
  { value: 'start', label: 'Arrowhead at start', glyph: <ArrowLeft size={16} /> },
  { value: 'end', label: 'Arrowhead at end', glyph: <ArrowRight size={16} /> },
  { value: 'both', label: 'Arrowheads at both ends', glyph: <MoveHorizontal size={16} /> },
];

/** The eight colours on the ramp: ink, then the hues in wheel order, then grey. */
export function quickSwatches(colors: PaletteColor[]): PaletteColor[] {
  return QUICK_SLOTS.flatMap((slot) => colors[slot] ?? []);
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
}

interface SegmentOption<T> {
  value: T;
  label: string;
  glyph: ReactNode;
  style?: CSSProperties;
}

/**
 * One choice among a few: a radiogroup with a single pill that travels to the
 * chosen segment. Every setting on the bar and in the panel is one of these,
 * so they all look and behave alike — arrows move the choice, and focus
 * follows it.
 */
function Segmented<T extends string | number>({
  label,
  labelledBy,
  options,
  value,
  onSelect,
  tooltips = false,
  fill = false,
}: {
  label?: string;
  labelledBy?: string;
  options: SegmentOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  /** Name each segment on hover, for rows with no visible label. */
  tooltips?: boolean;
  /** Stretch the segments across the row. */
  fill?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((option) => option.value === value);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      (Math.max(index, 0) + delta + options.length) % options.length;
    onSelect(options[next]!.value);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      onKeyDown={onKeyDown}
      className={cn('tbar-seg shrink-0', fill && 'tbar-seg-fill')}
    >
      <span
        aria-hidden="true"
        className={cn('tbar-chip', index < 0 && 'opacity-0')}
        style={
          {
            '--seg-count': options.length,
            '--seg-index': Math.max(index, 0),
          } as CSSProperties
        }
      />
      {options.map((option, i) => {
        const checked = i === index;
        const props: React.ComponentProps<'button'> = {
          ref: (node) => {
            refs.current[i] = node;
          },
          type: 'button',
          role: 'radio',
          'aria-label': option.label,
          'aria-checked': checked,
          // With nothing chosen (a mixed selection) the first segment holds
          // the group's tab stop.
          tabIndex: checked || (index < 0 && i === 0) ? 0 : -1,
          onClick: () => onSelect(option.value),
          className: 'tbar-item',
          style: option.style,
        };
        return tooltips ? (
          <Tooltip key={String(option.value)}>
            <TooltipTrigger render={<button {...props} />}>
              {option.glyph}
            </TooltipTrigger>
            <TooltipContent side="top">{option.label}</TooltipContent>
          </Tooltip>
        ) : (
          <button key={String(option.value)} {...props}>
            {option.glyph}
          </button>
        );
      })}
    </div>
  );
}

function Swatch({
  swatch,
  selected,
  tabStop,
  onSelect,
  buttonRef,
}: {
  swatch: PaletteColor;
  selected: boolean;
  tabStop: boolean;
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
            tabIndex={tabStop ? 0 : -1}
            onClick={onSelect}
            className="tbar-item"
          />
        }
      >
        <span
          aria-hidden="true"
          className="tbar-swatch"
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
 * The quick ramp, closed by a key holding the whole palette. That key is the
 * ramp's ninth slot: a wheel of the ramp's own hues at rest, and the chosen
 * colour itself — ringed — when the choice came from the full palette.
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
  const colors = paletteColors(theme);
  const swatches = quickSwatches(colors);
  const onRamp = swatches.some((swatch) => swatch.value === color);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);

  useCloseWithBar(barVisible, setOpen);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const index = refs.current.indexOf(event.target as HTMLButtonElement);
    const next = (index + delta + swatches.length) % swatches.length;
    onSelect(swatches[next]!.value);
    refs.current[next]?.focus();
  };

  const hues = swatches.slice(1, -1).map((swatch) => swatch.value);
  const wheel = `conic-gradient(${[...hues, hues[0]].join(', ')})`;
  const current = colors.find((c) => c.value === color)?.name ?? color;

  return (
    <div className="tbar-group tbar-ramp shrink-0">
      <div
        role="radiogroup"
        aria-label="Color"
        onKeyDown={onKeyDown}
        className="flex items-center"
      >
        {swatches.map((swatch, i) => (
          <Swatch
            key={swatch.value}
            swatch={swatch}
            selected={swatch.value === color}
            tabStop={swatch.value === color || (!onRamp && i === 0)}
            onSelect={() => onSelect(swatch.value)}
            buttonRef={(node) => {
              refs.current[i] = node;
            }}
          />
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <ToolbarItem
          label={onRamp ? 'More colors' : `More colors, ${current} chosen`}
          tooltip={<span>More colors</span>}
          render={<PopoverTrigger />}
        >
          <span
            aria-hidden="true"
            className="tbar-swatch"
            data-selected={onRamp ? undefined : ''}
            style={
              onRamp
                ? { background: wheel, borderColor: 'transparent' }
                : { backgroundColor: color, borderColor: swatchBorder(color) }
            }
          />
        </ToolbarItem>

        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="tbar-surface tbar-panel w-auto"
        >
          <PopoverHeader className="sr-only">
            <PopoverTitle>Colors</PopoverTitle>
          </PopoverHeader>
          <div
            role="radiogroup"
            aria-label="All colors"
            className="grid grid-cols-4"
          >
            {colors.map((swatch, i) => (
              <Swatch
                key={swatch.value}
                swatch={swatch}
                selected={swatch.value === color}
                tabStop={
                  swatch.value === color ||
                  (i === 0 && !colors.some((c) => c.value === color))
                }
                onSelect={() => {
                  onSelect(swatch.value);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function EraserMode() {
  const eraserMode = useCanvasUiStore((s) => s.eraserMode);
  const setEraserMode = useCanvasUiStore((s) => s.setEraserMode);
  return (
    <Segmented
      label="Eraser mode"
      tooltips
      options={ERASER_MODES.map(({ mode, label, Preview }) => ({
        value: mode,
        label,
        glyph: <Preview />,
      }))}
      value={eraserMode}
      onSelect={setEraserMode}
    />
  );
}

/** A labelled row in the options panel. The label names the row's control. */
function Section({
  label,
  aside,
  children,
}: {
  label: string;
  aside?: ReactNode;
  children: (labelId: string) => ReactNode;
}) {
  const id = useId();
  return (
    <div className="tbar-section">
      <div className="tbar-section-head">
        <span id={id}>{label}</span>
        {aside}
      </div>
      {children(id)}
    </div>
  );
}

function OptionsKey({
  barVisible,
  children,
}: {
  barVisible: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);

  useCloseWithBar(barVisible, setOpen);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ToolbarItem label="Options" caret render={<PopoverTrigger />}>
        <SlidersHorizontal />
      </ToolbarItem>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="tbar-surface tbar-panel w-56"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>Options</PopoverTitle>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function ToolPropertiesSatellite({
  activeToolId,
}: {
  activeToolId: string;
}) {
  const { visible, show, values, apply } = useStyleControls(activeToolId);

  // Keep the last tool's controls while the bar animates out.
  const shown = useRef(show);
  if (visible) shown.current = show;
  const on = shown.current;

  const ends: Ends =
    values.arrowStart && values.arrowEnd
      ? 'both'
      : values.arrowStart
        ? 'start'
        : values.arrowEnd
          ? 'end'
          : 'none';

  // What the shape is first, then how it is painted, then how solid it is.
  const sections: ReactNode[] = [];
  if (on.font) {
    sections.push(
      <Section key="font" label="Font">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={FONTS.map(({ family, label }) => ({
              value: family,
              label: FONT_NAMES[family],
              glyph: label,
              style: { fontFamily: fontStack(family) },
            }))}
            value={values.fontFamily}
            onSelect={apply.fontFamily}
          />
        )}
      </Section>,
      <Section key="weight" label="Weight">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={WEIGHTS.map(({ weight, label }) => ({
              value: weight,
              label,
              glyph: 'A',
              style: {
                fontFamily: fontStack(values.fontFamily),
                fontWeight: weight,
              },
            }))}
            value={values.fontWeight}
            onSelect={apply.fontWeight}
          />
        )}
      </Section>,
    );
  }
  if (on.align) {
    sections.push(
      <Section key="align" label="Align">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={ALIGNS.map(({ align, Icon }) => ({
              value: align,
              label: { start: 'Left', middle: 'Center', end: 'Right' }[align],
              glyph: <Icon aria-hidden="true" />,
            }))}
            value={values.align}
            onSelect={apply.align}
          />
        )}
      </Section>,
    );
  }
  if (on.arrows) {
    sections.push(
      <Section key="route" label="Route">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={ARROW_TOPOLOGIES.map((option) => ({
              value: option.value,
              label: option.label,
              glyph: <RoutePreview route={option.value} />,
            }))}
            value={values.arrowTopology}
            onSelect={apply.arrowTopology}
          />
        )}
      </Section>,
      <Section key="ends" label="Ends">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={ENDS}
            value={ends}
            onSelect={(next) => {
              apply.arrowStart(next === 'start' || next === 'both');
              apply.arrowEnd(next === 'end' || next === 'both');
            }}
          />
        )}
      </Section>,
    );
  }
  if (on.lineOptions) {
    sections.push(
      <Section key="curve" label="Curve">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={SPLINES.map((spline) => ({
              value: spline,
              label: SPLINE_LABELS[spline],
              glyph: <SplinePreview spline={spline} />,
            }))}
            value={values.lineSpline}
            onSelect={apply.lineSpline}
          />
        )}
      </Section>,
    );
  }
  if (on.fill) {
    sections.push(
      <Section key="fill" label="Fill">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={FILLS.map((fillStyle) => ({
              value: fillStyle,
              label: FILL_LABELS[fillStyle],
              glyph: <FillPreview style={fillStyle} />,
            }))}
            value={values.fill}
            onSelect={apply.fill}
          />
        )}
      </Section>,
    );
  }
  if (on.dash) {
    sections.push(
      <Section key="stroke" label="Stroke">
        {(id) => (
          <Segmented
            fill
            labelledBy={id}
            options={DASHES.map((dash) => ({
              value: dash,
              label: DASH_LABELS[dash],
              glyph: <DashPreview dash={dash} />,
            }))}
            value={values.dash}
            onSelect={apply.dash}
          />
        )}
      </Section>,
    );
  }
  if (on.opacity) {
    sections.push(
      <Section
        key="opacity"
        label="Opacity"
        aside={
          <span className="tabular-nums">
            {Math.round(values.opacity * 100)}%
          </span>
        }
      >
        {() => (
          <div className="px-1 py-1.5">
            <OpacitySlider
              aria-label="Opacity"
              value={values.opacity}
              onValueChange={apply.opacity}
            />
          </div>
        )}
      </Section>,
    );
  }
  if (on.connectorLabel) {
    sections.push(
      <Section key="label" label="Label">
        {(id) => (
          <Input
            aria-labelledby={id}
            value={values.connectorLabel}
            onChange={(event) => apply.connectorLabel(event.target.value)}
          />
        )}
      </Section>,
    );
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
      <ToolbarSurface
        role="group"
        aria-label="Style controls"
        className="tbar tbar-style"
      >
        {on.eraserMode ? <EraserMode /> : null}
        {on.color ? (
          <ColorRamp
            color={values.color}
            onSelect={apply.color}
            barVisible={visible}
          />
        ) : null}
        {on.size ? (
          <Segmented
            label="Stroke weight"
            tooltips
            options={SIZE_OPTIONS.map((option, i) => ({
              value: option.value,
              label: WEIGHT_NAMES[option.name] ?? option.name,
              glyph: (
                <span
                  aria-hidden="true"
                  className="tbar-weight"
                  style={{ height: WEIGHT_STROKES[i] ?? 2 }}
                />
              ),
            }))}
            value={values.size}
            onSelect={apply.size}
          />
        ) : null}
        {on.sticker ? <StickerStrip /> : null}
        {sections.length > 0 ? (
          <OptionsKey barVisible={visible}>{sections}</OptionsKey>
        ) : null}
      </ToolbarSurface>
    </div>
  );
}
