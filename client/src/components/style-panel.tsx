import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import type {
  FillStyle,
  FontFamily,
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
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ChevronsUpDown } from 'lucide-react';


const FILLS: FillStyle[] = ['none', 'solid', 'hatch', 'crosshatch'];
const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];
const FILLABLE = new Set(['rectangle', 'ellipse', 'polygon']);
const DASHABLE = new Set(['rectangle', 'ellipse', 'polygon', 'line', 'arrow', 'draw']);

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



/** Color, stroke width, fill, dash, and text styling — applied to the
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



  // Contextual visibility checks
  const isStylePanelVisible = (() => {
    if (activeToolId === 'eraser' || activeToolId === 'hand' || activeToolId === 'laser') {
      return false;
    }
    if (activeToolId === 'select' || activeToolId === 'lasso') {
      return selectedIds.length > 0;
    }
    return true;
  })();

  if (!isStylePanelVisible) {
    return null;
  }



  // Dynamic filter based on tool/selection type
  const targetType = (() => {
    if (activeToolId !== 'select' && activeToolId !== 'lasso') {
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
    for (const id of selectedIds) editor.updateShape(id, { props: { color: c } });
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

  const applyAlign = (a: TextAlign) => {
    setAlign(a);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'text') {
        editor.updateShape(id, { props: { align: a } });
      }
    }
  };

  return (
    <Surface className="absolute top-[calc(3.75rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 w-[min(14rem,calc(100vw-2rem))] p-4 shadow-floating">
      <div className="flex flex-col">
        {/* Color + opacity — the always-present group. Label-less by design:
            the swatches and slider read on their own, keeping the panel calm. */}
        <div className="flex flex-col gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-full justify-between gap-2 px-2 text-content-subtle"
                />
              }
            >
              <span className="flex items-center gap-1.5">
                {colors.slice(0, 4).map((c) => (
                  <span
                    key={c.name}
                    className="size-3 rounded-full border border-border-default"
                    style={{ background: c.value }}
                  />
                ))}
                <span className="text-[13px] font-medium text-content-emphasis">
                  {activePalette.name}
                </span>
              </span>
              <ChevronsUpDown className="size-3.5 text-content-subtle" aria-hidden="true" />
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--anchor-width)">
              <DropdownMenuRadioGroup
                value={paletteId}
                onValueChange={setPaletteId}
              >
                {PALETTES.map((p) => (
                  <DropdownMenuRadioItem key={p.id} value={p.id} closeOnClick>
                    <span className="flex items-center gap-1.5">
                      {(theme === 'dark' ? p.dark : p.light)
                        .slice(0, 4)
                        .map((c) => (
                          <span
                            key={c.name}
                            className="size-3 rounded-full border border-border-default"
                            style={{ background: c.value }}
                          />
                        ))}
                      {p.name}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <div role="group" aria-label="Color" className="grid grid-cols-4 gap-2">
            {colors.map((c) => {
              const active = color === c.value;
              return (
                <button
                  key={c.name}
                  type="button"
                  title={c.name}
                  aria-label={c.name}
                  aria-pressed={active}
                  onClick={() => applyColor(c.value)}
                  className={cn(
                    'flex cursor-pointer items-center justify-center rounded-lg p-1 transition-colors',
                    active ? 'bg-bg-muted' : 'hover:bg-bg-muted',
                  )}
                >
                  <span
                    className="size-8 rounded-full border border-border-default transition-transform active:scale-95"
                    style={{ background: c.value }}
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

        {/* Segmented property controls for the current tool/selection. */}
        {hasShapeControls && (
          <>
            <Separator className="my-4" />
            <div className="flex flex-col gap-3">
              {showFill && (
                <ToggleGroup
                  aria-label="Fill style"
                  value={[fill]}
                  onValueChange={(val) => val[0] && applyFill(val[0] as FillStyle)}
                >
                  {FILLS.map((f) => (
                    <ToggleGroupItem key={f} value={f} title={f}>
                      <FillPreview style={f} />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {showDash && (
                <ToggleGroup
                  aria-label="Stroke dash"
                  value={[dash]}
                  onValueChange={(val) => val[0] && applyDash(val[0] as StrokeDash)}
                >
                  {DASHES.map((d) => (
                    <ToggleGroupItem key={d} value={d} title={d}>
                      <DashPreview dash={d} />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {showSize && (
                <ToggleGroup
                  aria-label="Stroke size"
                  value={[String(size)]}
                  onValueChange={(val) => val[0] && applySize(Number(val[0]))}
                >
                  {SIZE_OPTIONS.map((o) => (
                    <ToggleGroupItem key={o.name} value={String(o.value)}>
                      {o.name}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {showFont && (
                <ToggleGroup
                  aria-label="Font"
                  value={[fontFamily]}
                  onValueChange={(val) => val[0] && applyFontFamily(val[0] as FontFamily)}
                >
                  {FONTS.map(({ family, label }) => (
                    <ToggleGroupItem
                      key={family}
                      value={family}
                      style={{ fontFamily: fontStack(family) }}
                    >
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}

              {showAlign && (
                <ToggleGroup
                  aria-label="Alignment"
                  value={[align]}
                  onValueChange={(val) => val[0] && applyAlign(val[0] as TextAlign)}
                >
                  {ALIGNS.map(({ align: a, Icon }) => (
                    <ToggleGroupItem key={a} value={a}>
                      <Icon className="size-4" />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              )}
            </div>
          </>
        )}

        {/* Contextual row: arrowhead ends (arrows only). */}
        {showArrows && (
          <>
            <Separator className="my-4" />
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-content-emphasis select-none">
                Arrows
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant={arrowStart ? 'secondary' : 'ghost'}
                  size="icon-xs"
                  aria-pressed={arrowStart}
                  aria-label="Arrowhead at start"
                  title="Arrowhead at start"
                  onClick={() => applyArrowStart(!arrowStart)}
                >
                  <ArrowLeft />
                </Button>
                <Button
                  variant={arrowEnd ? 'secondary' : 'ghost'}
                  size="icon-xs"
                  aria-pressed={arrowEnd}
                  aria-label="Arrowhead at end"
                  title="Arrowhead at end"
                  onClick={() => applyArrowEnd(!arrowEnd)}
                >
                  <ArrowRight />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Surface>
  );
}
