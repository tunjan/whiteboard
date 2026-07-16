import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { Eye, EyeOff, Pause, Play, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type {
  GraphExpression,
  GraphParameter,
  GraphProps,
  GraphShape,
  GraphViewport,
  StrokeDash,
} from '@whiteboard/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MathField } from '@/components/ui/math-field';
import { PanelLabel } from '@/components/ui/panel-label';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DEFAULT_GRAPH_VIEWPORT,
  GRAPH_COLORS,
  createGraphExpression,
  parseGraphExpression,
  reconcileGraphParameters,
} from '@/canvas/graph-expressions';
import { breakUndoCapture, editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { cn } from '@/lib/utils';
import { useAnimationStore } from '@/animation/use-animation-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';

const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];

function valueFromSlider(value: number | number[]): number {
  return Array.isArray(value) ? value[0]! : value;
}

/** Trails `value` by `delay` ms — used to keep parse errors quiet while the
 * user is still typing (Desmos-style). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function DashPreview({ dash }: { dash: StrokeDash }) {
  const dasharray =
    dash === 'dashed' ? '5 4' : dash === 'dotted' ? '0 4' : undefined;
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

function expressionError(source: string): string | null {
  if (!source.trim()) return null;
  const parsed = parseGraphExpression(source);
  return parsed.ok ? null : parsed.message;
}

/** Swatch button opening the curve's color + line style controls. The dot is
 * filled when the curve is visible and outline-only when hidden. */
function CurveStylePopover({
  expression,
  onPatch,
}: {
  expression: GraphExpression;
  onPatch: (patch: Partial<GraphExpression>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Curve color and line style"
        title="Color & line style"
        className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-bg-muted"
      >
        <span
          className="size-4 rounded-full border-2 transition-colors"
          style={{
            borderColor: expression.color,
            background: expression.visible ? expression.color : 'transparent',
          }}
        />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-44">
        <PopoverTitle>Curve style</PopoverTitle>
        <div className="flex flex-col gap-1.5">
          <PanelLabel>Color</PanelLabel>
          <div role="group" aria-label="Curve color" className="grid grid-cols-4 gap-1">
            {GRAPH_COLORS.map((color) => {
              const active = expression.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  aria-pressed={active}
                  onClick={() => onPatch({ color })}
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md transition-colors',
                    active ? 'bg-bg-muted' : 'hover:bg-bg-muted',
                  )}
                >
                  <span
                    className="size-4 rounded-full border border-border-default"
                    style={{ background: color }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <PanelLabel>Line style</PanelLabel>
          <ToggleGroup
            aria-label="Line style"
            value={[expression.dash]}
            onValueChange={(value) => {
              const dash = value[0] as StrokeDash | undefined;
              if (dash) onPatch({ dash });
            }}
          >
            {DASHES.map((dash) => (
              <ToggleGroupItem key={dash} value={dash} title={dash}>
                <DashPreview dash={dash} />
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** One Desmos-style expression row: numbered gutter with the curve's style
 * swatch, a math field, and hover-revealed visibility/delete actions. */
function ExpressionRow({
  expression,
  index,
  onPatch,
  onDelete,
  onEnter,
  onBackspaceEmpty,
  onMoveOut,
  registerField,
}: {
  expression: GraphExpression;
  index: number;
  onPatch: (patch: Partial<GraphExpression>) => void;
  onDelete: () => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onMoveOut: (direction: 'upward' | 'downward') => void;
  registerField: (el: MathfieldElement | null) => void;
}) {
  // Errors only surface once typing pauses, so half-finished expressions
  // ("y=", "sin(") don't flash red on every keystroke.
  const settled = useDebouncedValue(expression.expression, 500);
  const error =
    settled === expression.expression ? expressionError(settled) : null;

  return (
    <div className="group relative flex items-start gap-1 px-1.5 py-1 transition-colors focus-within:bg-bg-subtle">
      <div className="flex h-9 w-8 shrink-0 items-center justify-center">
        <CurveStylePopover expression={expression} onPatch={onPatch} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <MathField
          id={`graph-expression-${expression.id}`}
          aria-label={`Expression ${index + 1}`}
          aria-invalid={error ? true : undefined}
          className={cn(
            'w-full transition-opacity',
            !expression.visible && 'opacity-50',
          )}
          value={expression.expression}
          placeholder="y=sin(x) or x^2+y^2=1"
          elementRef={registerField}
          onChange={(value) => onPatch({ expression: value })}
          onEnter={onEnter}
          onBackspaceEmpty={onBackspaceEmpty}
          onMoveOut={onMoveOut}
        />
        {error ? (
          <div className="px-2 pb-1 text-xs font-medium text-content-error">
            {error}
          </div>
        ) : null}
      </div>

      <div className="touch-reveal flex h-9 shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={expression.visible ? 'Hide curve' : 'Show curve'}
          aria-pressed={!expression.visible}
          title={expression.visible ? 'Hide curve' : 'Show curve'}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={() => onPatch({ visible: !expression.visible })}
        >
          {expression.visible ? <Eye /> : <EyeOff />}
        </button>
        <button
          type="button"
          aria-label="Delete curve"
          title="Delete curve"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={onDelete}
        >
          <Trash2 />
        </button>
      </div>
    </div>
  );
}

function SliderRow({
  name,
  parameter,
  onChange,
}: {
  name: string;
  parameter: GraphParameter;
  onChange: (parameter: GraphParameter) => void;
}) {
  const [minDraft, setMinDraft] = useState(String(parameter.min));
  const [maxDraft, setMaxDraft] = useState(String(parameter.max));
  const [playing, setPlaying] = useState(false);

  // Re-sync when the parameter changes elsewhere.
  useEffect(() => setMinDraft(String(parameter.min)), [parameter.min]);
  useEffect(() => setMaxDraft(String(parameter.max)), [parameter.max]);

  // Latest parameter/onChange reachable from the animation loop without
  // restarting it on every value write.
  const paramRef = useRef(parameter);
  paramRef.current = parameter;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Ping-pong the value between min and max (full sweep ~4s), like a Desmos
  // animated slider. Writes are throttled to ~30fps to limit collab/undo churn.
  useEffect(() => {
    if (!playing) return;
    breakUndoCapture();
    let raf = 0;
    let last = performance.now();
    let lastWrite = 0;
    let dir = 1;
    let v = paramRef.current.value;
    const tick = (now: number) => {
      const p = paramRef.current;
      const span = p.max - p.min || 1;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      v += dir * (span / 4) * dt;
      if (v >= p.max) {
        v = p.max;
        dir = -1;
      } else if (v <= p.min) {
        v = p.min;
        dir = 1;
      }
      if (now - lastWrite >= 33) {
        lastWrite = now;
        onChangeRef.current({ ...p, value: v });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const commitBound = (bound: 'min' | 'max', raw: string) => {
    const value = Number(raw);
    const next =
      bound === 'min'
        ? { min: value, max: parameter.max }
        : { min: parameter.min, max: value };
    if (Number.isFinite(value) && next.min < next.max) {
      onChange({
        ...parameter,
        ...next,
        value: Math.min(next.max, Math.max(next.min, parameter.value)),
      });
    } else if (bound === 'min') {
      setMinDraft(String(parameter.min));
    } else {
      setMaxDraft(String(parameter.max));
    }
  };

  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={playing ? `Pause ${name}` : `Animate ${name}`}
            aria-pressed={playing}
            title={playing ? 'Pause' : 'Animate'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? <Pause /> : <Play />}
          </button>
          <FieldLabel className="font-mono">{name}</FieldLabel>
        </div>
        <span className="font-mono text-xs tabular-nums text-content-subtle">
          = {Number(parameter.value.toPrecision(4))}
        </span>
      </div>
      <div className="flex items-center gap-1.5">
        <BoundInput
          label={`${name} minimum`}
          value={minDraft}
          onChange={setMinDraft}
          onCommit={(raw) => commitBound('min', raw)}
          className="text-center"
        />
        <Slider
          aria-label={name}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={parameter.value}
          onValueChange={(value) =>
            onChange({ ...parameter, value: valueFromSlider(value) })
          }
          className="min-w-0 flex-1"
        />
        <BoundInput
          label={`${name} maximum`}
          value={maxDraft}
          onChange={setMaxDraft}
          onCommit={(raw) => commitBound('max', raw)}
          className="text-center"
        />
      </div>
    </Field>
  );
}

function BoundInput({
  label,
  value,
  onChange,
  onCommit,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
  className?: string;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      aria-label={label}
      title={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      onBlur={(event) => onCommit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onCommit(event.currentTarget.value);
          event.currentTarget.blur();
        }
      }}
      className={cn('h-7 w-12 shrink-0 px-1 font-mono text-xs', className)}
    />
  );
}

const VIEWPORT_FIELDS: { key: keyof GraphViewport; label: string }[] = [
  { key: 'xMin', label: 'X min' },
  { key: 'xMax', label: 'X max' },
  { key: 'yMin', label: 'Y min' },
  { key: 'yMax', label: 'Y max' },
];

function ViewRange({
  viewport,
  onChange,
  onReset,
}: {
  viewport: GraphViewport;
  onChange: (viewport: GraphViewport) => void;
  onReset: () => void;
}) {
  const toDraft = (v: GraphViewport) => ({
    xMin: String(v.xMin),
    xMax: String(v.xMax),
    yMin: String(v.yMin),
    yMax: String(v.yMax),
  });
  const [draft, setDraft] = useState(() => toDraft(viewport));

  // Re-sync when the viewport changes elsewhere (scroll zoom, Reset).
  useEffect(() => {
    setDraft(toDraft(viewport));
  }, [viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax]);

  const commit = (key: keyof GraphViewport) => {
    const value = Number(draft[key]);
    const next = { ...viewport, [key]: value };
    const valid =
      Number.isFinite(value) && next.xMin < next.xMax && next.yMin < next.yMax;
    if (valid) onChange(next);
    else setDraft((d) => ({ ...d, [key]: String(viewport[key]) }));
  };

  return (
    <FieldGroup className="gap-2">
      <div className="flex items-center justify-between">
        <PanelLabel>View range</PanelLabel>
        <Button
          variant="ghost"
          size="xs"
          title="Reset to the default view"
          onClick={onReset}
        >
          <RotateCcw data-icon="inline-start" />
          Reset
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {VIEWPORT_FIELDS.map(({ key, label }) => (
          <Field key={key} orientation="horizontal" className="gap-2">
            <FieldLabel className="w-10 shrink-0 text-xs text-content-subtle">
              {label}
            </FieldLabel>
            <Input
              type="number"
              inputMode="decimal"
              aria-label={label}
              value={draft[key]}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setDraft((d) => ({ ...d, [key]: value }));
              }}
              onBlur={() => commit(key)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commit(key);
                  event.currentTarget.blur();
                }
              }}
            />
          </Field>
        ))}
      </div>
    </FieldGroup>
  );
}

function GraphPanelContent({ shape }: { shape: GraphShape }) {
  const fieldRefs = useRef(new Map<string, MathfieldElement>());

  // Focus a row's math field once it has mounted (e.g. after add/delete).
  const focusField = (id: string, tries = 5) => {
    const el = fieldRefs.current.get(id);
    if (el) el.focus();
    else if (tries > 0) requestAnimationFrame(() => focusField(id, tries - 1));
  };

  const props = shape.props;
  const showAxisLabels = props.showAxisLabels !== false;

  const updateGraph = (patch: Partial<GraphProps>) => {
    editor.updateShape(shape.id, { props: patch });
  };

  const updateExpressions = (expressions: GraphExpression[]) => {
    updateGraph({
      expressions,
      parameters: reconcileGraphParameters(expressions, props.parameters),
    });
  };

  const patchExpression = (
    expressionId: string,
    patch: Partial<GraphExpression>,
  ) => {
    updateExpressions(
      props.expressions.map((expression) =>
        expression.id === expressionId ? { ...expression, ...patch } : expression,
      ),
    );
  };

  const addExpression = () => {
    const created = createGraphExpression(props.expressions.length);
    updateExpressions([...props.expressions, created]);
    focusField(created.id);
  };

  // Enter inside a row inserts a new expression directly below it (Desmos).
  const insertExpressionAfter = (afterId: string) => {
    const created = createGraphExpression(props.expressions.length);
    const next = [...props.expressions];
    const index = next.findIndex((expression) => expression.id === afterId);
    next.splice(index + 1, 0, created);
    updateExpressions(next);
    focusField(created.id);
  };

  const deleteExpression = (expressionId: string) => {
    const next = props.expressions.filter((expression) => expression.id !== expressionId);
    updateExpressions(next.length ? next : [createGraphExpression(0)]);
  };

  // Backspace in an empty row removes it and focuses the previous one, unless
  // it is the only row left.
  const deleteEmptyExpression = (expressionId: string) => {
    if (props.expressions.length <= 1) return;
    const index = props.expressions.findIndex((e) => e.id === expressionId);
    const next = props.expressions.filter((e) => e.id !== expressionId);
    updateExpressions(next);
    const target = next[index - 1] ?? next[0];
    if (target) focusField(target.id);
  };

  // Arrow up/down at a row boundary moves focus to the adjacent row (Desmos).
  const moveFocus = (fromId: string, direction: 'upward' | 'downward') => {
    const index = props.expressions.findIndex((e) => e.id === fromId);
    const target =
      props.expressions[direction === 'upward' ? index - 1 : index + 1];
    if (target) focusField(target.id);
  };

  const parameterNames = Object.keys(props.parameters).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <Surface
      role="region"
      aria-label="Graph controls"
      className="touch-targets flex max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto p-4 shadow-floating"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-content-emphasis">Plotter</div>
        <div className="text-xs text-content-subtle">
          {props.expressions.length} curve{props.expressions.length === 1 ? '' : 's'}
          {parameterNames.length > 0
            ? ` · ${parameterNames.length} slider${parameterNames.length === 1 ? '' : 's'}`
            : ''}
        </div>
      </div>

      {/* Desmos-style expression list: full-bleed rows with hairline dividers. */}
      <div className="-mx-4 flex flex-col divide-y divide-border-subtle border-y border-border-subtle">
        {props.expressions.map((expression, index) => (
          <ExpressionRow
            key={expression.id}
            expression={expression}
            index={index}
            onPatch={(patch) => patchExpression(expression.id, patch)}
            onDelete={() => deleteExpression(expression.id)}
            onEnter={() => insertExpressionAfter(expression.id)}
            onBackspaceEmpty={() => deleteEmptyExpression(expression.id)}
            onMoveOut={(direction) => moveFocus(expression.id, direction)}
            registerField={(el) => {
              if (el) fieldRefs.current.set(expression.id, el);
              else fieldRefs.current.delete(expression.id);
            }}
          />
        ))}
        <button
          type="button"
          onClick={addExpression}
          className="flex w-full items-center gap-2 px-3.5 py-2 text-left text-sm text-content-subtle transition-colors hover:bg-bg-muted hover:text-content-emphasis"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add curve
        </button>
      </div>

      {parameterNames.length > 0 ? (
        <>
          <FieldGroup className="gap-3">
            <PanelLabel>Sliders</PanelLabel>
            {parameterNames.map((name) => {
              const parameter = props.parameters[name]!;
              return (
                <SliderRow
                  key={name}
                  name={name}
                  parameter={parameter}
                  onChange={(next) =>
                    updateGraph({
                      parameters: {
                        ...props.parameters,
                        [name]: next,
                      },
                    })
                  }
                />
              );
            })}
          </FieldGroup>
          <Separator />
        </>
      ) : null}

      <ViewRange
        viewport={props.viewport}
        onChange={(viewport) => updateGraph({ viewport })}
        onReset={() => updateGraph({ viewport: { ...DEFAULT_GRAPH_VIEWPORT } })}
      />

      <Field orientation="horizontal">
        <FieldLabel>Axis numbers</FieldLabel>
        <Switch
          aria-label="Axis numbers"
          checked={showAxisLabels}
          onCheckedChange={(checked) => updateGraph({ showAxisLabels: checked })}
        />
      </Field>
    </Surface>
  );
}

export function GraphPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  const playbackActive = useAnimationStore((s) => s.playbackActive);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedShape = selectedId ? shapesRecord?.[selectedId] : undefined;
  const graphShape =
    selectedShape?.type === 'graph' ? selectedShape : undefined;
  const panelVisible = !playbackActive && Boolean(graphShape);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && graphShape ? (
        <GraphPanelContent shape={graphShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
