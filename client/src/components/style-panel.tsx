import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  LineSpline,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { orthogonalRoute } from '@/canvas/shapes/connector-routing';
import { fontStack } from '@/canvas/shapes/text-measure';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import {
  paletteColors,
  SIZE_OPTIONS,
  useStyleStore,
} from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { OpacitySlider } from '@/components/opacity-slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ToolPanelPresence } from '@/components/tool-panel-presence';

const FILLS: FillStyle[] = ['none', 'solid', 'hatch', 'crosshatch'];
const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted', 'draw'];
// Draw shapes take a fill too, but only show it once the stroke closed on
// itself — an open squiggle has no interior to paint.
const FILLABLE = new Set(['rectangle', 'ellipse', 'polygon', 'draw']);
const DASHABLE = new Set([
  'rectangle',
  'ellipse',
  'polygon',
  'line',
  'arrow',
  'draw',
]);

const FILL_LABELS: Record<FillStyle, string> = {
  none: 'No fill',
  solid: 'Solid fill',
  hatch: 'Hatched fill',
  crosshatch: 'Crosshatched fill',
};
const DASH_LABELS: Record<StrokeDash, string> = {
  solid: 'Solid stroke',
  dashed: 'Dashed stroke',
  dotted: 'Dotted stroke',
  draw: 'Hand-drawn stroke',
};
const FONTS: { family: FontFamily; label: string }[] = [
  { family: 'sans', label: 'Aa' },
  { family: 'serif', label: 'Aa' },
  { family: 'mono', label: 'Aa' },
  { family: 'hand', label: 'Aa' },
];
const WEIGHTS: { weight: FontWeight; label: string }[] = [
  { weight: 400, label: 'Regular' },
  { weight: 500, label: 'Medium' },
  { weight: 600, label: 'Semibold' },
  { weight: 700, label: 'Bold' },
];
// Toggle rows span the panel and divide it evenly, so every row lines up with
// the swatch grid's edges (and its columns, for four-option rows).
const TOGGLE_ROW = 'w-full';
const TOGGLE_ITEM = 'grow basis-0';
const ALIGNS: {
  align: TextAlign;
  Icon: ComponentType<{
    className?: string;
    'aria-hidden'?: boolean | 'true' | 'false';
  }>;
}[] = [
  { align: 'start', Icon: AlignLeft },
  { align: 'middle', Icon: AlignCenter },
  { align: 'end', Icon: AlignRight },
];
const ARROW_TOPOLOGIES: Array<{
  value: ArrowTopology;
  label: string;
  glyph: string;
}> = [
  { value: 'straight', label: 'Straight arrow', glyph: '—' },
  { value: 'arc', label: 'Curved arrow', glyph: '⌒' },
  { value: 'elbow', label: 'Elbow arrow', glyph: '└' },
];

function FillPreview({ style }: { style: FillStyle }) {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x={2.5}
        y={2.5}
        width={11}
        height={11}
        rx={1.5}
        fill={style === 'solid' ? 'currentColor' : 'none'}
        fillOpacity={style === 'solid' ? 0.35 : undefined}
        stroke="currentColor"
        strokeWidth={1}
      />
      {style === 'hatch' ? (
        <path
          d="M4 12 L12 4 M7 13 L13 7 M3 9 L9 3"
          stroke="currentColor"
          strokeWidth={0.8}
        />
      ) : null}
      {style === 'crosshatch' ? (
        <path
          d="M4 12 L12 4 M4 4 L12 12"
          stroke="currentColor"
          strokeWidth={0.8}
        />
      ) : null}
    </svg>
  );
}

function DashPreview({ dash }: { dash: StrokeDash }) {
  if (dash === 'draw') {
    return (
      <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
        <path
          d="M2 6.4 Q6 4.9 10 6.1 T20 5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
        <path
          d="M2 5.7 Q6 6.8 10 5.6 T20 6.3"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  const dasharray =
    dash === 'dashed' ? '4 3' : dash === 'dotted' ? '0 4' : undefined;
  return (
    <svg width={22} height={12} viewBox="0 0 22 12" aria-hidden="true">
      <line
        x1={2}
        y1={6}
        x2={20}
        y2={6}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
    </svg>
  );
}

/** Color, stroke width, fill, dash, and text styling - applied to the
 * selection and to new shapes. */
export function StylePanel() {
  const {
    color,
    size,
    fill,
    dash,
    opacity,
    arrowStart,
    arrowEnd,
    arrowTopology,
    lineSpline,
    fontFamily,
    fontWeight,
    align,
  } = useStyleStore();
  const theme = useThemeStore((s) => s.theme);
  const colors = paletteColors(theme);
  const {
    setColor,
    setSize,
    setFill,
    setDash,
    setOpacity,
    setArrowStart,
    setArrowEnd,
    setArrowTopology,
    setLineSpline,
    setFontFamily,
    setFontWeight,
    setAlign,
  } = useStyleStore.getState();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeToolId = useToolStore((s) => s.activeToolId);
  // The panel only needs the *type* the selection resolves to, so derive it
  // inside the selector and subscribe to that string. Subscribing to the page
  // shapes record instead would re-render this panel once per frame of every
  // stroke, because the record is a fresh object on every mutation.
  const selectedType = useDocumentStore((s) => {
    if (selectedIds.length === 0) return null;
    const firstId = selectedIds[0];
    const firstShape = firstId ? s.shapesById.get(firstId) : undefined;
    if (!firstShape) return null;
    const allSameType = selectedIds.every(
      (id) => id && s.shapesById.get(id)?.type === firstShape.type,
    );
    return allSameType ? firstShape.type : 'mixed';
  });
  // Whether the selection holds a stroke that closed on itself. Only those have
  // an interior, so the fill control would be inert on any other pen stroke.
  const hasClosedDraw = useDocumentStore((s) =>
    selectedIds.some((id) => {
      const shape = id ? s.shapesById.get(id) : undefined;
      return shape?.type === 'draw' && shape.props.isClosed;
    }),
  );
  const connectorLabel = useDocumentStore((s) => {
    if (selectedIds.length !== 1) return '';
    const id = selectedIds[0];
    const shape = id ? s.shapesById.get(id) : undefined;
    return shape && (shape.type === 'line' || shape.type === 'arrow')
      ? (shape.props.label ?? '')
      : '';
  });
  // Contextual visibility checks
  const isStylePanelVisible = (() => {
    // The eraser paints nothing, so every control here would be inert on it;
    // its one setting — object vs precision — rides on its toolbar button.
    if (
      activeToolId === 'hand' ||
      activeToolId === 'laser' ||
      activeToolId === 'eraser'
    ) {
      return false;
    }
    if (activeToolId === 'select') {
      return selectedIds.length > 0;
    }
    return true;
  })();

  // Dynamic filter based on tool/selection type. The wand draws pen strokes, so
  // it wants the pen's controls.
  const targetType =
    activeToolId === 'wand'
      ? 'draw'
      : activeToolId !== 'select'
        ? activeToolId
        : selectedType;

  const panelVisible =
    isStylePanelVisible && targetType !== 'graph' && targetType !== 'equation';

  // Media and stickers carry fixed artwork colors. Frames do expose color for
  // their structural border and title, while opacity remains shape-level.
  const showColor =
    targetType !== 'image' &&
    targetType !== 'sticker' &&
    targetType !== 'video' &&
    targetType !== 'bookmark';

  const showSize =
    targetType === 'draw' ||
    targetType === 'line' ||
    targetType === 'arrow' ||
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'mixed';

  const showFill =
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'mixed' ||
    (targetType === 'draw' && (activeToolId !== 'select' || hasClosedDraw));

  const showDash =
    targetType === 'draw' ||
    targetType === 'line' ||
    targetType === 'arrow' ||
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'mixed';

  const showFont = targetType === 'text' || targetType === 'mixed';
  const showAlign = targetType === 'text' || targetType === 'mixed';
  const showArrows = targetType === 'arrow';
  const showLineOptions = targetType === 'line';
  const showConnectorLabel =
    activeToolId === 'select' &&
    selectedIds.length === 1 &&
    (targetType === 'line' || targetType === 'arrow');
  const panelContentKey =
    activeToolId === 'select'
      ? `selection-${targetType ?? 'default'}`
      : `tool-${targetType ?? 'default'}`;

  // Swatches always include the active color: a persisted choice can hold a
  // value the current palette does not contain, and a color grid with
  // nothing selected reads as "no color set".
  const offPalette = !colors.some((c) => c.value === color);
  const swatches = offPalette
    ? [...colors, { name: 'Current color', value: color }]
    : colors;
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Switching theme keeps the same slot rather than stranding the pen on a
  // color that is no longer shown.
  const previousTheme = useRef(theme);
  useEffect(() => {
    if (previousTheme.current === theme) return;
    const from = paletteColors(previousTheme.current);
    const to = paletteColors(theme);
    previousTheme.current = theme;
    const slot = from.findIndex(
      (c) => c.value === useStyleStore.getState().color,
    );
    const next = slot >= 0 ? to[slot] : undefined;
    if (next) setColor(next.value);
  }, [theme]);

  const applyColor = (c: string) => {
    setColor(c);
    for (const id of selectedIds)
      editor.updateShape(id, { props: { color: c } });
  };

  // Arrow keys move between swatches, matching radiogroup conventions.
  const moveSwatchFocus = (from: number, delta: number) => {
    const next = (from + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    applyColor(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  const applySize = (n: number) => {
    setSize(n);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && shape.type !== 'text') {
        editor.updateShape(id, { props: { size: n } });
      }
    }
  };

  const applyFill = (f: FillStyle) => {
    setFill(f);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && FILLABLE.has(shape.type)) {
        editor.updateShape(id, { props: { fillStyle: f } });
      }
    }
  };

  const applyDash = (d: StrokeDash) => {
    setDash(d);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && DASHABLE.has(shape.type)) {
        editor.updateShape(id, { props: { dash: d } });
      }
    }
  };

  // Sets the opacity of the current selection (any shape type) and the style
  // default new shapes inherit.
  const applyOpacity = (o: number) => {
    setOpacity(o);
    for (const id of selectedIds) editor.updateShape(id, { opacity: o });
  };

  const applyArrowTopology = (topology: ArrowTopology) => {
    setArrowTopology(topology);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape?.type !== 'arrow' || shape.props.points.length < 2) continue;
      const first = shape.props.points[0]!;
      const last = shape.props.points[shape.props.points.length - 1]!;
      const length = Math.hypot(last.x - first.x, last.y - first.y);
      editor.updateShape(id, {
        props: {
          topology,
          points:
            topology === 'elbow' ? orthogonalRoute(first, last) : [first, last],
          bend:
            topology === 'arc'
              ? Math.abs(shape.props.bend ?? 0) >= 0.5
                ? shape.props.bend
                : Math.max(18, Math.min(80, length * 0.2))
              : 0,
        },
      });
    }
  };

  const applyArrowStart = (value: boolean) => {
    setArrowStart(value);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowStart: value } });
      }
    }
  };

  const applyArrowEnd = (value: boolean) => {
    setArrowEnd(value);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowEnd: value } });
      }
    }
  };

  const applyLineSpline = (spline: LineSpline) => {
    setLineSpline(spline);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'line') {
        editor.updateShape(id, { props: { spline } });
      }
    }
  };

  const applyConnectorLabel = (label: string) => {
    const id = selectedIds[0];
    const shape = id ? editor.getShape(id) : undefined;
    if (shape && (shape.type === 'line' || shape.type === 'arrow')) {
      editor.updateShape(shape.id, { props: { label } });
    }
  };

  const applyFontFamily = (f: FontFamily) => {
    setFontFamily(f);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'text') {
        editor.updateShape(id, { props: { fontFamily: f } });
      }
    }
  };

  const applyFontWeight = (w: FontWeight) => {
    setFontWeight(w);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'text') {
        editor.updateShape(id, { props: { fontWeight: w } });
      }
    }
  };

  const applyAlign = (a: TextAlign) => {
    setAlign(a);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'text') {
        editor.updateShape(id, { props: { align: a } });
      }
    }
  };

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible ? (
        <Surface
          role="region"
          aria-label="Style controls"
          className="touch-targets w-[min(14.5rem,calc(100vw-2rem))] max-h-[calc(100dvh-8rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain p-3.5 sm:max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
        >
          <TooltipProvider delay={300}>
            <div
              key={panelContentKey}
              className="tool-panel-content flex flex-col gap-2.5"
            >
              <div className="flex flex-col gap-2">
                {showColor ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <div
                        role="radiogroup"
                        aria-label="Color"
                        className="grid grid-cols-4 gap-1.5"
                      >
                        {swatches.map((paletteColor, index) => {
                          const active = color === paletteColor.value;
                          return (
                            <Tooltip key={paletteColor.value}>
                              <TooltipTrigger
                                render={
                                  <button
                                    ref={(node) => {
                                      swatchRefs.current[index] = node;
                                    }}
                                    type="button"
                                    role="radio"
                                    aria-label={paletteColor.name}
                                    aria-checked={active}
                                    tabIndex={active ? 0 : -1}
                                    onClick={() =>
                                      applyColor(paletteColor.value)
                                    }
                                    onKeyDown={(event) => {
                                      const delta =
                                        event.key === 'ArrowRight' ||
                                        event.key === 'ArrowDown'
                                          ? 1
                                          : event.key === 'ArrowLeft' ||
                                              event.key === 'ArrowUp'
                                            ? -1
                                            : 0;
                                      if (!delta) return;
                                      event.preventDefault();
                                      moveSwatchFocus(index, delta);
                                    }}
                                    className="flex h-8 w-full items-center justify-center rounded-md transition-colors duration-150 ease-out hover:bg-accent active:scale-[0.98] motion-reduce:transition-none"
                                  />
                                }
                              >
                                <span
                                  className={cn(
                                    'size-5 rounded-full border',
                                    active &&
                                      'ring-2 ring-ring ring-offset-2 ring-offset-background',
                                  )}
                                  style={{
                                    backgroundColor: paletteColor.value,
                                    borderColor: swatchBorder(
                                      paletteColor.value,
                                    ),
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                {paletteColor.name}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : null}

                <Tooltip>
                  <TooltipTrigger render={<div />}>
                    <OpacitySlider
                      aria-label="Opacity"
                      value={opacity}
                      onValueChange={applyOpacity}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="left">
                    Opacity {Math.round(opacity * 100)}%
                  </TooltipContent>
                </Tooltip>
              </div>

              {showFill ||
              showDash ||
              showSize ||
              showFont ||
              showAlign ||
              showArrows ||
              showLineOptions ||
              showConnectorLabel ? (
                <div className="flex flex-col gap-2">
                  {showFill ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Fill style"
                      value={[fill]}
                      onValueChange={(values) =>
                        values[0] && applyFill(values[0] as FillStyle)
                      }
                    >
                      {FILLS.map((fillStyle) => (
                        <Tooltip key={fillStyle}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={fillStyle}
                                aria-label={FILL_LABELS[fillStyle]}
                              />
                            }
                          >
                            <FillPreview style={fillStyle} />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {FILL_LABELS[fillStyle]}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showDash ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Stroke style"
                      value={[dash]}
                      onValueChange={(values) =>
                        values[0] && applyDash(values[0] as StrokeDash)
                      }
                    >
                      {DASHES.map((strokeDash) => (
                        <Tooltip key={strokeDash}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={strokeDash}
                                aria-label={DASH_LABELS[strokeDash]}
                              />
                            }
                          >
                            <DashPreview dash={strokeDash} />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {DASH_LABELS[strokeDash]}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showSize ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Stroke weight"
                      value={[String(size)]}
                      onValueChange={(values) =>
                        values[0] && applySize(Number(values[0]))
                      }
                    >
                      {SIZE_OPTIONS.map((option) => (
                        <Tooltip key={option.name}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={String(option.value)}
                                aria-label={`${option.name}, ${option.value} pixels`}
                              />
                            }
                          >
                            {option.name}
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {option.name} — {option.value}px
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showFont ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Typeface"
                      value={[fontFamily]}
                      onValueChange={(values) =>
                        values[0] && applyFontFamily(values[0] as FontFamily)
                      }
                    >
                      {FONTS.map(({ family, label }) => (
                        <Tooltip key={family}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={family}
                                aria-label={`${family} typeface`}
                                style={{ fontFamily: fontStack(family) }}
                              />
                            }
                          >
                            {label}
                          </TooltipTrigger>
                          <TooltipContent side="left">{family}</TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showFont ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Font weight"
                      value={[String(fontWeight)]}
                      onValueChange={(values) =>
                        values[0] &&
                        applyFontWeight(Number(values[0]) as FontWeight)
                      }
                    >
                      {WEIGHTS.map(({ weight, label }) => (
                        <Tooltip key={weight}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={String(weight)}
                                aria-label={`${label} weight`}
                                // Preview each option in the weight it applies, using
                                // the typeface currently selected.
                                style={{
                                  fontFamily: fontStack(fontFamily),
                                  fontWeight: weight,
                                }}
                              />
                            }
                          >
                            A
                          </TooltipTrigger>
                          <TooltipContent side="left">{label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showAlign ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Text alignment"
                      value={[align]}
                      onValueChange={(values) =>
                        values[0] && applyAlign(values[0] as TextAlign)
                      }
                    >
                      {ALIGNS.map(({ align: textAlign, Icon }) => (
                        <Tooltip key={textAlign}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={textAlign}
                                aria-label={`${textAlign} alignment`}
                              />
                            }
                          >
                            <Icon aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {textAlign} alignment
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {showLineOptions ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      spacing={1.5}
                      aria-label="Line interpolation"
                      value={[lineSpline ?? 'linear']}
                      onValueChange={(values) =>
                        values[0] && applyLineSpline(values[0] as LineSpline)
                      }
                    >
                      <ToggleGroupItem className={TOGGLE_ITEM} value="linear">
                        Linear
                      </ToggleGroupItem>
                      <ToggleGroupItem className={TOGGLE_ITEM} value="smooth">
                        Smooth
                      </ToggleGroupItem>
                    </ToggleGroup>
                  ) : null}

                  {showArrows ? (
                    <>
                      <ToggleGroup
                        className={TOGGLE_ROW}
                        spacing={1.5}
                        aria-label="Arrow route"
                        value={[arrowTopology ?? 'straight']}
                        onValueChange={(values) =>
                          values[0] &&
                          applyArrowTopology(values[0] as ArrowTopology)
                        }
                      >
                        {ARROW_TOPOLOGIES.map((option) => (
                          <Tooltip key={option.value}>
                            <TooltipTrigger
                              render={
                                <ToggleGroupItem
                                  className={TOGGLE_ITEM}
                                  value={option.value}
                                  aria-label={option.label}
                                />
                              }
                            >
                              <span
                                className="text-base leading-none"
                                aria-hidden="true"
                              >
                                {option.glyph}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              {option.label}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </ToggleGroup>
                      <ToggleGroup
                        className={TOGGLE_ROW}
                        spacing={1.5}
                        multiple
                        aria-label="Arrowheads"
                        value={[
                          ...(arrowStart ? ['start'] : []),
                          ...(arrowEnd ? ['end'] : []),
                        ]}
                        onValueChange={(values) => {
                          applyArrowStart(values.includes('start'));
                          applyArrowEnd(values.includes('end'));
                        }}
                      >
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value="start"
                                aria-label="Arrowhead at start"
                              />
                            }
                          >
                            <ArrowLeft aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Arrowhead at start
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value="end"
                                aria-label="Arrowhead at end"
                              />
                            }
                          >
                            <ArrowRight aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Arrowhead at end
                          </TooltipContent>
                        </Tooltip>
                      </ToggleGroup>
                    </>
                  ) : null}

                  {showConnectorLabel ? (
                    <Input
                      aria-label="Connector label"
                      placeholder="Label"
                      value={connectorLabel}
                      onChange={(event) =>
                        applyConnectorLabel(event.target.value)
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </TooltipProvider>
        </Surface>
      ) : null}
    </ToolPanelPresence>
  );
}
