import { useEffect } from 'react';
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
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { fontStack } from '@/canvas/shapes/text-measure';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { usePenPresetsStore } from '@/canvas/use-pen-presets-store';
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
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useAnimationStore } from '@/animation/use-animation-store';

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
];
const ALIGNS: { align: TextAlign; Icon: typeof AlignLeft }[] = [
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
  const { color, size, fill, dash, opacity, arrowStart, arrowEnd, fontFamily, align, paletteId } =
    useStyleStore();
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
    setAlign,
    setPaletteId,
  } = useStyleStore.getState();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  const playbackActive = useAnimationStore((s) => s.playbackActive);
  const { presets, activeIndex } = usePenPresetsStore();

  // The pen tool has 3 dedicated presets; re-applying the active one whenever
  // the draw tool becomes active keeps the drawing style in sync even if the
  // user changed color/size on another tool in the meantime.
  useEffect(() => {
    if (activeToolId !== 'draw') return;
    const { presets, activeIndex } = usePenPresetsStore.getState();
    const preset = presets[activeIndex];
    if (preset) {
      setColor(preset.color);
      setSize(preset.size);
    }
  }, [activeToolId]);



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

  if (playbackActive || !isStylePanelVisible) {
    return null;
  }



  // Dynamic filter based on tool/selection type
  const targetType = (() => {
    if (activeToolId !== 'select') {
      return activeToolId;
    }
    if (selectedIds.length > 0 && shapesRecord) {
      const firstId = selectedIds[0];
      if (firstId) {
        const firstShape = shapesRecord[firstId];
        if (firstShape) {
          const allSameType = selectedIds.every(
            (id) => id && shapesRecord[id]?.type === firstShape.type,
          );
          if (allSameType) {
            return firstShape.type;
          }
          return 'mixed';
        }
      }
    }
    return null;
  })();

  if (targetType === 'graph') {
    return null;
  }

  const showSize =
    targetType === 'draw' ||
    targetType === 'line' ||
    targetType === 'arrow' ||
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'frame' ||
    targetType === 'mixed';

  const showFill =
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'frame' ||
    targetType === 'mixed';

  const showDash =
    targetType === 'draw' ||
    targetType === 'line' ||
    targetType === 'arrow' ||
    targetType === 'rectangle' ||
    targetType === 'ellipse' ||
    targetType === 'polygon' ||
    targetType === 'frame' ||
    targetType === 'mixed';

  const showFont = targetType === 'text' || targetType === 'mixed';
  const showAlign = targetType === 'text' || targetType === 'mixed';
  const showArrows = targetType === 'arrow';

  // Whether the middle group (segmented controls) has any visible row.
  const hasShapeControls = showSize || showFill || showDash || showFont || showAlign;

  const applyColor = (c: string) => {
    setColor(c);
    if (activeToolId === 'draw') usePenPresetsStore.getState().updateActive({ color: c });
    for (const id of selectedIds) editor.updateShape(id, { props: { color: c } });
  };

  const applySize = (n: number) => {
    setSize(n);
    if (activeToolId === 'draw') usePenPresetsStore.getState().updateActive({ size: n });
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && shape.type !== 'text') {
        editor.updateShape(id, { props: { size: n } });
      }
    }
  };

  // Selects a pen preset: makes it active and applies its color/size so new
  // strokes use it (Miro-style pen slots).
  const applyPreset = (i: number) => {
    const preset = presets[i];
    if (!preset) return;
    usePenPresetsStore.getState().setActive(i);
    setColor(preset.color);
    setSize(preset.size);
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

  const applyAlign = (a: TextAlign) => {
    setAlign(a);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'text') {
        editor.updateShape(id, { props: { align: a } });
      }
    }
  };

  return (
    <Surface
      role="region"
      aria-label="Style controls"
      className="touch-targets absolute top-[calc(3.75rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] w-[min(14rem,calc(100vw-2rem))] overflow-y-auto overscroll-contain p-4 shadow-floating"
    >
      <div className="flex flex-col">
        {activeToolId === 'draw' ? (
          <>
            <ToggleGroup
              aria-label="Pen presets"
              value={[String(activeIndex)]}
              onValueChange={(values) =>
                values[0] && applyPreset(Number(values[0]))
              }
            >
              {presets.map((preset, index) => {
                const dotSize = Math.min(18, 8 + preset.size * 0.65);
                return (
                  <ToggleGroupItem
                    key={index}
                    value={String(index)}
                    aria-label={`Pen preset ${index + 1}`}
                    title={`Pen preset ${index + 1}`}
                    className="h-9"
                  >
                    <span
                      className="rounded-full border border-border-default"
                      style={{
                        backgroundColor: preset.color,
                        width: dotSize,
                        height: dotSize,
                      }}
                    />
                  </ToggleGroupItem>
                );
              })}
            </ToggleGroup>
            <Separator className="my-3" />
          </>
        ) : null}

        <div className="flex flex-col gap-2.5">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between"
                />
              }
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="flex shrink-0 items-center gap-1">
                  {colors.slice(0, 4).map((paletteColor) => (
                    <span
                      key={paletteColor.name}
                      className="size-2.5 rounded-full border border-border-default"
                      style={{ backgroundColor: paletteColor.value }}
                    />
                  ))}
                </span>
                <span className="truncate">{activePalette.name}</span>
              </span>
              <ChevronsUpDown data-icon="inline-end" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--anchor-width)">
              <DropdownMenuRadioGroup
                value={paletteId}
                onValueChange={setPaletteId}
              >
                {PALETTES.map((palette) => (
                  <DropdownMenuRadioItem
                    key={palette.id}
                    value={palette.id}
                    closeOnClick
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex shrink-0 items-center gap-1">
                        {(theme === 'dark' ? palette.dark : palette.light)
                          .slice(0, 4)
                          .map((paletteColor) => (
                            <span
                              key={paletteColor.name}
                              className="size-2.5 rounded-full border border-border-default"
                              style={{ backgroundColor: paletteColor.value }}
                            />
                          ))}
                      </span>
                      <span className="truncate">{palette.name}</span>
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div
            role="group"
            aria-label="Color"
            className="grid grid-cols-4 gap-1.5"
          >
            {colors.map((paletteColor) => {
              const active = color === paletteColor.value;
              return (
                <button
                  key={paletteColor.name}
                  type="button"
                  title={paletteColor.name}
                  aria-label={paletteColor.name}
                  aria-pressed={active}
                  onClick={() => applyColor(paletteColor.value)}
                  className="flex h-9 w-full items-center justify-center rounded-lg transition-colors duration-150 ease-out hover:bg-bg-muted active:scale-[0.98] motion-reduce:transition-none"
                >
                  <span
                    className={cn(
                      'size-6 rounded-full border border-border-default',
                      active &&
                        'ring-2 ring-accent-brand ring-offset-2 ring-offset-bg-default',
                    )}
                    style={{ backgroundColor: paletteColor.value }}
                  />
                </button>
              );
            })}
          </div>

          <div className="px-0.5">
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
          </div>
        </div>

        {hasShapeControls || showArrows ? <Separator className="my-3" /> : null}

        <div className="flex flex-col gap-2.5">
          {showFill ? (
            <ToggleGroup
              aria-label="Fill style"
              value={[fill]}
              onValueChange={(values) =>
                values[0] && applyFill(values[0] as FillStyle)
              }
            >
              {FILLS.map((fillStyle) => (
                <ToggleGroupItem
                  key={fillStyle}
                  value={fillStyle}
                  aria-label={FILL_LABELS[fillStyle]}
                  title={FILL_LABELS[fillStyle]}
                >
                  <FillPreview style={fillStyle} />
                </ToggleGroupItem>
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
                <ToggleGroupItem
                  key={strokeDash}
                  value={strokeDash}
                  aria-label={DASH_LABELS[strokeDash]}
                  title={DASH_LABELS[strokeDash]}
                >
                  <DashPreview dash={strokeDash} />
                </ToggleGroupItem>
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
                <ToggleGroupItem
                  key={option.name}
                  value={String(option.value)}
                  aria-label={`${option.name}, ${option.value} pixels`}
                  title={`${option.value}px`}
                >
                  {option.name}
                </ToggleGroupItem>
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
                <ToggleGroupItem
                  key={family}
                  value={family}
                  aria-label={`${family} typeface`}
                  title={family}
                  style={{ fontFamily: fontStack(family) }}
                >
                  {label}
                </ToggleGroupItem>
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
                <ToggleGroupItem
                  key={textAlign}
                  value={textAlign}
                  aria-label={`${textAlign} alignment`}
                  title={`${textAlign} alignment`}
                >
                  <Icon aria-hidden="true" />
                </ToggleGroupItem>
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
              <ToggleGroupItem
                value="start"
                aria-label="Arrowhead at start"
                title="Arrowhead at start"
              >
                <ArrowLeft aria-hidden="true" />
              </ToggleGroupItem>
              <ToggleGroupItem
                value="end"
                aria-label="Arrowhead at end"
                title="Arrowhead at end"
              >
                <ArrowRight aria-hidden="true" />
              </ToggleGroupItem>
            </ToggleGroup>
          ) : null}
        </div>
      </div>
    </Surface>
  );
}
