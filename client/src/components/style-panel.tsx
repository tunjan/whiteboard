import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
  ChevronsUpDown,
} from 'lucide-react';
import type {
  FillStyle,
  FontFamily,
  FontWeight,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { fontStack } from '@/canvas/shapes/text-measure';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import {
  PALETTES,
  paletteColors,
  SIZE_OPTIONS,
  useStyleStore,
} from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { useThemeStore } from '@/use-theme-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PanelLabel } from '@/components/ui/panel-label';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useAnimationStore } from '@/animation/use-animation-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';

const FILLS: FillStyle[] = ['none', 'solid', 'hatch', 'crosshatch'];
const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];
const FILLABLE = new Set(['rectangle', 'ellipse', 'polygon']);
const DASHABLE = new Set(['rectangle', 'ellipse', 'polygon', 'line', 'arrow', 'draw']);

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
const swatchBorder = (color: string) => `color-mix(in srgb, ${color} 75%, #000)`;
const ALIGNS: { align: TextAlign; Icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }> }[] = [
  { align: 'start', Icon: AlignLeft },
  { align: 'middle', Icon: AlignCenter },
  { align: 'end', Icon: AlignRight },
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
        <path d="M4 12 L12 4 M7 13 L13 7 M3 9 L9 3" stroke="currentColor" strokeWidth={0.8} />
      ) : null}
      {style === 'crosshatch' ? (
        <path d="M4 12 L12 4 M4 4 L12 12" stroke="currentColor" strokeWidth={0.8} />
      ) : null}
    </svg>
  );
}

function DashPreview({ dash }: { dash: StrokeDash }) {
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
    fontFamily,
    fontWeight,
    align,
    paletteId,
  } = useStyleStore();
  const theme = useThemeStore((s) => s.theme);
  const activePalette = PALETTES.find((p) => p.id === paletteId) ?? PALETTES[0]!;
  const colors = paletteColors(paletteId, theme);
  const {
    setColor,
    setSize,
    setFill,
    setDash,
    setOpacity,
    setArrowStart,
    setArrowEnd,
    setFontFamily,
    setFontWeight,
    setAlign,
    setPaletteId,
  } = useStyleStore.getState();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeToolId = useToolStore((s) => s.activeToolId);
  // The panel only needs the *type* the selection resolves to, so derive it
  // inside the selector and subscribe to that string. Subscribing to the page
  // shapes record instead would re-render this panel once per frame of every
  // stroke, because the record is a fresh object on every mutation.
  const selectedType = useDocumentStore((s) => {
    const record = s.doc.pages[s.currentPageId]?.shapes;
    if (!record || selectedIds.length === 0) return null;
    const firstId = selectedIds[0];
    const firstShape = firstId ? record[firstId] : undefined;
    if (!firstShape) return null;
    const allSameType = selectedIds.every(
      (id) => id && record[id]?.type === firstShape.type,
    );
    return allSameType ? firstShape.type : 'mixed';
  });
  const playbackActive = useAnimationStore((s) => s.playbackActive);

  // Contextual visibility checks
  const isStylePanelVisible = (() => {
    if (activeToolId === 'eraser' || activeToolId === 'hand' || activeToolId === 'laser') {
      return false;
    }
    if (activeToolId === 'select') {
      return selectedIds.length > 0;
    }
    return true;
  })();

  // Dynamic filter based on tool/selection type
  const targetType =
    activeToolId !== 'select' ? activeToolId : selectedType;

  const panelVisible =
    !playbackActive &&
    isStylePanelVisible &&
    targetType !== 'graph' &&
    targetType !== 'equation';

  // Frames are fixed chrome, images/videos are media with no style props: none
  // of them carry a color/size/fill/dash prop, so that control would be inert.
  // Opacity is a shape-level field and still applies to all of them.
  const showColor =
    targetType !== 'frame' && targetType !== 'image' && targetType !== 'video';

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
    targetType === 'mixed';

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

  // Switching palette or theme keeps the same slot rather than stranding the
  // pen on a color that is no longer shown.
  const previousTheme = useRef(theme);
  useEffect(() => {
    if (previousTheme.current === theme) return;
    const from = paletteColors(paletteId, previousTheme.current);
    const to = paletteColors(paletteId, theme);
    previousTheme.current = theme;
    const slot = from.findIndex((c) => c.value === useStyleStore.getState().color);
    const next = slot >= 0 ? to[slot] : undefined;
    if (next) setColor(next.value);
  }, [theme, paletteId]);

  const applyColor = (c: string) => {
    setColor(c);
    for (const id of selectedIds) editor.updateShape(id, { props: { color: c } });
  };

  const changePalette = (id: string) => {
    const slot = colors.findIndex((c) => c.value === color);
    setPaletteId(id);
    const next = slot >= 0 ? paletteColors(id, theme)[slot] : undefined;
    if (next) applyColor(next.value);
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

  const applyArrowEnd = (v: boolean) => {
    setArrowEnd(v);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowEnd: v } });
      }
    }
  };

  const applyArrowStart = (v: boolean) => {
    setArrowStart(v);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowStart: v } });
      }
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
          className="touch-targets w-[min(12.5rem,calc(100vw-2rem))] max-h-[calc(100dvh-9rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain p-2.5 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
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
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="xs"
                        aria-label={`Color palette: ${activePalette.name}`}
                        className="w-full justify-between"
                      />
                    }
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="flex shrink-0 items-center gap-0.5">
                        {colors.slice(0, 4).map((paletteColor) => (
                          <span
                            key={paletteColor.name}
                            className="size-2 rounded-full border"
                            style={{
                              backgroundColor: paletteColor.value,
                              borderColor: swatchBorder(paletteColor.value),
                            }}
                          />
                        ))}
                      </span>
                      <span className="truncate">{activePalette.name}</span>
                    </span>
                    <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
                  </DropdownMenuTrigger>
                  {/* Opens to the side so the swatch grid it controls stays
                      visible while choosing. */}
                  <DropdownMenuContent side="left" align="start" className="w-auto">
                    <DropdownMenuRadioGroup
                      value={paletteId}
                      onValueChange={changePalette}
                    >
                      {PALETTES.map((palette) => (
                        <DropdownMenuRadioItem
                          key={palette.id}
                          value={palette.id}
                          closeOnClick
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="flex shrink-0 items-center gap-1">
                              {(theme === 'dark' ? palette.dark : palette.light).map(
                                (paletteColor) => (
                                  <span
                                    key={paletteColor.name}
                                    className="size-2.5 rounded-full border"
                                    style={{
                                      backgroundColor: paletteColor.value,
                                      borderColor: swatchBorder(paletteColor.value),
                                    }}
                                  />
                                ),
                              )}
                            </span>
                            <span className="truncate">{palette.name}</span>
                          </span>
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>

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
                              onClick={() => applyColor(paletteColor.value)}
                              onKeyDown={(event) => {
                                const delta =
                                  event.key === 'ArrowRight' || event.key === 'ArrowDown'
                                    ? 1
                                    : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
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
                              borderColor: swatchBorder(paletteColor.value),
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

          {/* The only control here with no self-describing glyph, so it keeps
              a readout; the tooltip names it. */}
          <Tooltip>
            <TooltipTrigger
              render={<div className="flex items-center gap-2 px-0.5" />}
            >
              <Slider
                aria-label="Opacity"
                min={0}
                max={1}
                step={0.01}
                value={opacity}
                onValueChange={(value) =>
                  applyOpacity(Array.isArray(value) ? value[0]! : value)
                }
              />
              <PanelLabel className="w-8 shrink-0 text-right tabular-nums">
                {Math.round(opacity * 100)}%
              </PanelLabel>
            </TooltipTrigger>
            <TooltipContent side="left">Opacity</TooltipContent>
          </Tooltip>
        </div>

        {showFill || showDash || showSize || showFont || showAlign || showArrows ? (
        <div className="flex flex-col gap-2">
          {showFill ? (
            <ToggleGroup
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
                aria-label="Font weight"
                value={[String(fontWeight)]}
                onValueChange={(values) =>
                  values[0] && applyFontWeight(Number(values[0]) as FontWeight)
                }
              >
                {WEIGHTS.map(({ weight, label }) => (
                  <Tooltip key={weight}>
                    <TooltipTrigger
                      render={
                        <ToggleGroupItem
                          value={String(weight)}
                          aria-label={`${label} weight`}
                          // Preview each option in the weight it applies, using
                          // the typeface currently selected.
                          style={{ fontFamily: fontStack(fontFamily), fontWeight: weight }}
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

          {showArrows ? (
            <ToggleGroup
                multiple
                aria-label="Arrowheads"
                value={[
                  ...(arrowStart ? ['start'] : []),
                  ...(arrowEnd ? ['end'] : []),
                ]}
                onValueChange={(values) => {
                  const nextStart = values.includes('start');
                  const nextEnd = values.includes('end');
                  if (nextStart !== arrowStart) applyArrowStart(nextStart);
                  if (nextEnd !== arrowEnd) applyArrowEnd(nextEnd);
                }}
              >
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem
                        value="start"
                        aria-label="Arrowhead at start"
                      />
                    }
                  >
                    <ArrowLeft aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="left">Arrowhead at start</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem
                        value="end"
                        aria-label="Arrowhead at end"
                      />
                    }
                  >
                    <ArrowRight aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="left">Arrowhead at end</TooltipContent>
                </Tooltip>
              </ToggleGroup>
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
