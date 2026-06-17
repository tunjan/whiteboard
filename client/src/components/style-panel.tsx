import { useEffect, useState, useRef } from 'react';
import { AlertCircle, AlignCenter, AlignLeft, AlignRight, ArrowLeft, ArrowRight, Grid, Eye, EyeOff, Trash, Plus } from 'lucide-react';
import type {
  FillStyle,
  FontFamily,
  PlotShape,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { validatePlotExpression } from '@/canvas/plot-expressions';
import { fontStack } from '@/canvas/shapes/text-measure';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import {
  COLOR_PALETTE,
  SIZE_OPTIONS,
  useStyleStore,
} from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PanelLabel } from '@/components/ui/panel-label';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { InputGroup, InputGroupInput, InputGroupAddon } from '@/components/ui/input-group';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';


const FILLS: FillStyle[] = ['none', 'solid', 'hatch', 'crosshatch'];
const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];
const FILLABLE = new Set(['rectangle', 'ellipse', 'polygon']);
const DASHABLE = new Set(['rectangle', 'ellipse', 'polygon', 'line', 'arrow']);

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

const CURVE_COLORS = ['#2f6df6', '#e5484d', '#1ea672', '#8b5cf6', '#f5a524'];

function getNextColor(currentColor: string): string {
  const index = CURVE_COLORS.indexOf(currentColor);
  if (index === -1) return CURVE_COLORS[0]!;
  return CURVE_COLORS[(index + 1) % CURVE_COLORS.length]!;
}

function PlotPanel({ shape }: { shape: PlotShape }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [initialValue, setInitialValue] = useState<string>('');

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const pendingFocusIndex = useRef<number | null>(null);

  // Focus newly added curve
  useEffect(() => {
    if (pendingFocusIndex.current !== null) {
      const idx = pendingFocusIndex.current;
      pendingFocusIndex.current = null;
      inputRefs.current[idx]?.focus();
      inputRefs.current[idx]?.select();
    }
  }, [shape.props.curves.length]);

  const commitCurveValue = (curveId: string, val: string) => {
    const nextCurves = shape.props.curves.map((c) =>
      c.id === curveId ? { ...c, expression: val } : c
    );
    editor.updateShape(shape.id, { props: { curves: nextCurves } });
  };

  // Sync draft expressions to shape props (debounced)
  useEffect(() => {
    if (!editingId) return;
    const timeout = window.setTimeout(() => {
      commitCurveValue(editingId, editingValue);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [editingValue, editingId]);

  const commitAndClear = (curveId: string, val: string) => {
    commitCurveValue(curveId, val);
    setEditingId(null);
  };

  const updateNumber = (
    key: 'xMin' | 'xMax' | 'yMin' | 'yMax',
    value: string,
  ) => {
    const next = Number(value);
    if (Number.isFinite(next)) editor.updateShape(shape.id, { props: { [key]: next } });
  };

  const toggleCurveEnabled = (index: number) => {
    const nextCurves = shape.props.curves.map((curve, idx) =>
      idx === index ? { ...curve, enabled: !curve.enabled } : curve,
    );
    editor.updateShape(shape.id, { props: { curves: nextCurves } });
  };

  const cycleCurveColor = (index: number) => {
    const nextCurves = shape.props.curves.map((curve, idx) =>
      idx === index ? { ...curve, color: getNextColor(curve.color) } : curve,
    );
    editor.updateShape(shape.id, { props: { curves: nextCurves } });
  };

  const deleteCurve = (index: number) => {
    if (shape.props.curves.length <= 1) return;
    const nextCurves = shape.props.curves.filter((_, idx) => idx !== index);
    editor.updateShape(shape.id, { props: { curves: nextCurves } });
  };

  const addCurve = () => {
    if (shape.props.curves.length >= 6) return;
    pendingFocusIndex.current = shape.props.curves.length;
    const nextCurves = [
      ...shape.props.curves,
      {
        id: `curve-${crypto.randomUUID()}`,
        expression: 'x',
        color: CURVE_COLORS[shape.props.curves.length % CURVE_COLORS.length]!,
        enabled: true,
      },
    ];
    editor.updateShape(shape.id, { props: { curves: nextCurves } });
  };

  const handleDragStart = (e: React.MouseEvent, key: 'xMin' | 'xMax' | 'yMin' | 'yMax') => {
    e.preventDefault();
    const startX = e.clientX;
    const initialVal = shape.props[key];
    let currentVal = initialVal;

    let rafId: number | null = null;
    let latestClientX = e.clientX;
    let shiftPressed = e.shiftKey;
    let altPressed = e.altKey;

    const updateValue = () => {
      const deltaX = latestClientX - startX;
      let multiplier = 0.05;
      if (shiftPressed) multiplier = 0.5;
      else if (altPressed) multiplier = 0.005;

      const rawNext = initialVal + deltaX * multiplier;
      // round to 3 decimals to avoid floating point issues while dragging with Alt
      const nextVal = Math.round(rawNext * 1000) / 1000;

      if (Number.isFinite(nextVal) && nextVal !== currentVal) {
        currentVal = nextVal;
        editor.updateShape(shape.id, { props: { [key]: nextVal } });
      }
      rafId = null;
    };

    const handleMouseMove = (moveEvent: MouseEvent) => {
      latestClientX = moveEvent.clientX;
      shiftPressed = moveEvent.shiftKey;
      altPressed = moveEvent.altKey;

      if (rafId === null) {
        rafId = requestAnimationFrame(updateValue);
      }
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';
  };

  const rangeInput = (
    key: 'xMin' | 'xMax' | 'yMin' | 'yMax',
    label: string,
    isInvalid: boolean,
  ) => {
    return (
      <InputGroup className={cn(
        "w-full min-w-0",
        isInvalid && "border-amber-500/80 dark:border-amber-600/80 focus-within:border-amber-500 focus-within:ring-amber-500"
      )}>
        <InputGroupAddon className="p-1 pr-0">
          <span
            onMouseDown={(e) => handleDragStart(e, key)}
            className="bg-muted hover:bg-muted/80 px-1 py-0.5 rounded text-[9px] cursor-ew-resize font-mono uppercase font-bold text-muted-foreground hover:text-foreground transition-colors shrink-0 select-none"
            title="Drag left/right or use mouse wheel to adjust"
          >
            {label}
          </span>
        </InputGroupAddon>
        <InputGroupInput
          type="number"
          value={shape.props[key]}
          step="0.5"
          onChange={(e) => updateNumber(key, e.currentTarget.value)}
          onWheel={(e) => {
            if (document.activeElement !== e.currentTarget) {
              return;
            }
            e.preventDefault();
            const step = 0.5;
            const direction = e.deltaY < 0 ? 1 : -1;
            const currentValue = shape.props[key];
            const nextVal = currentValue + direction * step;
            if (Number.isFinite(nextVal)) {
              editor.updateShape(shape.id, { props: { [key]: nextVal } });
            }
          }}
          aria-label={`${key.substring(0, 1).toUpperCase()} coordinate ${label}`}
          className="font-mono text-xs text-foreground [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none text-right pr-2"
        />
      </InputGroup>
    );
  };

  return (
    <div className="w-full flex flex-col h-full">
      {/* Consolidated Header containing Title, Add Curve, and Grid Toggle */}
      <div className="flex items-center justify-between border-b border-border pb-3 mb-3 gap-2 shrink-0">
        <PanelLabel>Plot</PanelLabel>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="xs"
            onClick={addCurve}
            disabled={shape.props.curves.length >= 6}
          >
            <Plus data-icon="inline-start" />
            Add Curve
          </Button>
          <Button
            variant={shape.props.showGrid ? 'secondary' : 'ghost'}
            size="icon-xs"
            aria-label="Toggle Grid"
            aria-pressed={shape.props.showGrid}
            onClick={() =>
              editor.updateShape(shape.id, {
                props: { showGrid: !shape.props.showGrid },
              })
            }
            title="Toggle Grid"
          >
            <Grid />
          </Button>
        </div>
      </div>

      {/* Scrollable Panel Content */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {/* Curves Section */}
        <div className="space-y-2">
          <PanelLabel>Curves</PanelLabel>
          <div className="flex flex-col gap-1.5">
            {shape.props.curves.map((curve, index) => {
              const isEditing = editingId === curve.id;
              const currentExpr = isEditing ? editingValue : curve.expression;
              const validation = validatePlotExpression(currentExpr);
              const isValid = validation.ok;
              const showRedError = !isValid && !isEditing;
              const showYellowError = !isValid && isEditing;

              return (
                <div
                  key={curve.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg px-2 py-1 transition-all bg-transparent hover:bg-muted/30 focus-within:bg-muted/40',
                    showRedError
                      ? 'bg-destructive/5 hover:bg-destructive/10 focus-within:bg-destructive/15'
                      : showYellowError
                        ? 'bg-amber-500/5 hover:bg-amber-500/10 focus-within:bg-amber-500/15'
                        : ''
                  )}
                >
                  {/* Color Swatch */}
                  <button
                    type="button"
                    aria-label={`Change curve color (current: ${curve.color})`}
                    onClick={() => cycleCurveColor(index)}
                    className="size-4 rounded-full border border-foreground/10 shrink-0 transition-transform hover:scale-110 active:scale-95 cursor-pointer"
                    style={{ backgroundColor: curve.color }}
                  />

                  {/* Input Field */}
                  <input
                    ref={(el) => {
                      inputRefs.current[index] = el;
                    }}
                    type="text"
                    value={currentExpr}
                    onFocus={() => {
                      setEditingId(curve.id);
                      setEditingValue(curve.expression);
                      setInitialValue(curve.expression);
                    }}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onBlur={() => {
                      if (editingId === curve.id) {
                        commitAndClear(curve.id, editingValue);
                      }
                    }}
                    placeholder="y = f(x)"
                    spellCheck={false}
                    aria-invalid={!isValid}
                    aria-label={`Formula for curve ${index + 1}`}
                    className="flex-1 bg-transparent border-0 p-0 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-0 min-w-0"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitAndClear(curve.id, editingValue);
                        e.currentTarget.blur();
                        const nextInput = inputRefs.current[index + 1];
                        if (nextInput) {
                          nextInput.focus();
                        } else if (shape.props.curves.length < 6) {
                          addCurve();
                        }
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        commitCurveValue(curve.id, initialValue);
                        setEditingId(null);
                        e.currentTarget.blur();
                      }
                    }}
                  />

                  {/* Warning/Error Icon with Tooltip */}
                  {!isValid && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<div className="text-amber-500 dark:text-amber-400 cursor-help shrink-0 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500 rounded-sm" tabIndex={0} />}>
                          <AlertCircle className="size-4" />
                        </TooltipTrigger>
                        <TooltipContent className="bg-amber-500 dark:bg-amber-600 text-white font-medium shadow-md">
                          {validation.message || 'Invalid expression'}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Action buttons (progressive disclosure: visible/higher opacity on hover) */}
                  <div className="flex items-center gap-0.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => toggleCurveEnabled(index)}
                      className="opacity-30 hover:opacity-100 focus:opacity-100 transition-opacity duration-150"
                      aria-label={curve.enabled ? 'Hide curve' : 'Show curve'}
                    >
                      {curve.enabled ? <Eye /> : <EyeOff />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      disabled={shape.props.curves.length <= 1}
                      onClick={() => deleteCurve(index)}
                      className="opacity-30 hover:opacity-100 focus:opacity-100 transition-opacity duration-150 text-muted-foreground hover:text-destructive"
                      aria-label="Delete curve"
                    >
                      <Trash />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Separator */}
        <Separator className="my-2" />

        {/* Axes Limits Section */}
        <div className="space-y-3">
          <PanelLabel>Axes Limits</PanelLabel>
          <div className="flex flex-col gap-2">
            {/* X Row */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground w-4 text-center select-none">X</span>
              {rangeInput('xMin', 'min', shape.props.xMin >= shape.props.xMax)}
              <span className="text-[10px] text-muted-foreground/50 font-mono text-center select-none shrink-0">→</span>
              {rangeInput('xMax', 'max', shape.props.xMin >= shape.props.xMax)}
            </div>

            {/* Y Row */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-muted-foreground w-4 text-center select-none">Y</span>
              {rangeInput('yMin', 'min', shape.props.yMin >= shape.props.yMax)}
              <span className="text-[10px] text-muted-foreground/50 font-mono text-center select-none shrink-0">→</span>
              {rangeInput('yMax', 'max', shape.props.yMin >= shape.props.yMax)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Color, stroke width, fill, dash, and text styling — applied to the
 * selection and to new shapes. */
export function StylePanel() {
  const { color, size, fill, dash, opacity, arrowStart, arrowEnd, fontFamily, align } =
    useStyleStore();
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
  } = useStyleStore.getState();
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );

  const selectedShape =
    selectedIds.length === 1 ? shapesRecord?.[selectedIds[0] ?? ''] : undefined;
  const selectedPlot = selectedShape?.type === 'plot' ? selectedShape : null;

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

  // Slide-out math plot inspector drawer on the right side
  if (selectedPlot) {
    return (
      <Surface className="absolute top-[4.5rem] right-4 z-20 h-fit max-h-[calc(100vh-6rem)] w-80 p-4 animate-in slide-in-from-right-4 duration-200 ease-out">
        <PlotPanel shape={selectedPlot} />
      </Surface>
    );
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

  // Opacity is local-only for now (not part of the shape model yet), so the
  // slider just reflects/updates the current style value. See StyleStore.opacity.
  const applyOpacity = (o: number) => {
    setOpacity(o);
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
    <Surface className="absolute top-[4.5rem] right-4 z-20 w-56 p-3.5">
      <div className="flex flex-col">
        {/* Color + opacity — the always-present group. Label-less by design:
            the swatches and slider read on their own, keeping the panel calm. */}
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Color" className="grid grid-cols-4 gap-1.5">
            {COLOR_PALETTE.map((c) => {
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
                    'flex items-center justify-center rounded-lg p-1 transition-colors cursor-pointer',
                    active ? 'bg-muted' : 'hover:bg-muted/60',
                  )}
                >
                  <span
                    className="size-8 rounded-full border border-foreground/15 dark:border-white/20 transition-transform active:scale-95"
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
            <Separator className="my-3.5" />
            <div className="flex flex-col gap-2.5">
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
            <Separator className="my-3.5" />
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-medium text-foreground select-none">
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
