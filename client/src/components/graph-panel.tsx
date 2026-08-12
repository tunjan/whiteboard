import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import {
  Eye,
  EyeOff,
  Info,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type {
  GraphExpression,
  GraphParameter,
  GraphPoint,
  GraphProps,
  GraphShape,
  GraphViewport,
  StrokeDash,
} from '@whiteboard/shared';
import { buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MathField } from '@/components/ui/math-field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DEFAULT_GRAPH_VIEWPORT,
  GRAPH_COLORS,
  createGraphExpression,
  createGraphPoint,
  parseGraphExpression,
  reconcileGraphParameters,
} from '@/canvas/graph-expressions';
import { breakUndoCapture, editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { cn } from '@/lib/utils';
import { ToolPanelPresence } from '@/components/tool-panel-presence';

const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];

function valueFromSlider(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : value[0]!;
}

/** Trails `value` by `delay` ms — keeps parse errors quiet while the user is
 * still typing (Desmos-style). */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function expressionError(source: string): string | null {
  if (!source.trim()) return null;
  const parsed = parseGraphExpression(source);
  return parsed.ok ? null : parsed.message;
}

/* ─── Eyebrow label — the system's signature ─────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-tertiary">
      {children}
    </span>
  );
}

/* ─── Section header row: eyebrow + optional action ─────────────────────── */

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Eyebrow>{label}</Eyebrow>
      {action}
    </div>
  );
}

/* ─── Dash SVG preview ────────────────────────────────────────────────────── */

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

/* ─── Curve style popover (colour + line style) ───────────────────────────── */

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
        className="grid size-7 place-items-center rounded-md transition-colors duration-[80ms] hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        {/* Filled when visible, outline-only when hidden — signals visibility state */}
        <span
          className="size-3.5 rounded-full border-2 transition-colors duration-[80ms]"
          style={{
            borderColor: expression.color,
            background: expression.visible ? expression.color : 'transparent',
          }}
        />
      </PopoverTrigger>

      <PopoverContent side="left" align="start" className="w-48 gap-4 p-4">
        {/* Eyebrow title inside the popover */}
        <div className="flex flex-col gap-3">
          <Eyebrow>Colour</Eyebrow>
          <div className="grid grid-cols-4 gap-1">
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
                    'grid size-8 place-items-center rounded-md transition-colors duration-[80ms]',
                    active ? 'bg-subtle ring-1 ring-border-strong' : 'hover:bg-subtle',
                  )}
                >
                  <span
                    className="size-3.5 rounded-full"
                    style={{ background: color }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Eyebrow>Line style</Eyebrow>
          {/* r_inner = 12 (rounded-lg container) − 4 (p-1) = 8 → rounded-md */}
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

/* ─── Expression row ─────────────────────────────────────────────────────── */
/**
 * One Desmos-style expression row: numbered gutter with the curve's style
 * swatch, a math field, and hover-revealed visibility/delete actions.
 */
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
  // Errors surface only after typing pauses — no red flashes on every keystroke.
  const settled = useDebouncedValue(expression.expression, 500);
  const error =
    settled === expression.expression ? expressionError(settled) : null;

  return (
    <div className="group relative flex items-start gap-1 px-3 py-2 transition-colors duration-[80ms] focus-within:bg-subtle/60">
      {/* Left gutter: 32 px — style swatch */}
      <div className="flex h-9 w-8 shrink-0 items-center justify-center">
        <CurveStylePopover expression={expression} onPatch={onPatch} />
      </div>

      {/* Math field */}
      <div className="flex min-w-0 flex-1 flex-col">
        <MathField
          id={`graph-expression-${expression.id}`}
          aria-label={`Expression ${index + 1}`}
          aria-invalid={error ? true : undefined}
          className={cn(
            'w-full transition-opacity duration-[80ms]',
            !expression.visible && 'opacity-40',
          )}
          value={expression.expression}
          placeholder="y=sin(x) or x²+y²=1"
          elementRef={registerField}
          onChange={(value) => onPatch({ expression: value })}
          onEnter={onEnter}
          onBackspaceEmpty={onBackspaceEmpty}
          onMoveOut={onMoveOut}
        />
        {error ? (
          <p className="px-1 pb-1 font-mono text-2xs text-danger">{error}</p>
        ) : null}
      </div>

      {/* Hover-revealed actions — visible on touch */}
      <div className="touch-reveal flex h-9 shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[80ms] group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={expression.visible ? 'Hide curve' : 'Show curve'}
          aria-pressed={!expression.visible}
          title={expression.visible ? 'Hide curve' : 'Show curve'}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={() => onPatch({ visible: !expression.visible })}
        >
          {expression.visible ? (
            <Eye strokeWidth={1.5} />
          ) : (
            <EyeOff strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          aria-label="Delete curve"
          title="Delete curve"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={onDelete}
        >
          <Trash2 strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

/* ─── Point style popover ────────────────────────────────────────────────── */

function PointStylePopover({
  point,
  onPatch,
}: {
  point: GraphPoint;
  onPatch: (patch: Partial<GraphPoint>) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Point color"
        title="Color"
        className="grid size-7 place-items-center rounded-md transition-colors duration-[80ms] hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
      >
        <span
          className="size-3.5 rounded-full border-2 transition-colors duration-[80ms]"
          style={{
            borderColor: point.color,
            background: point.visible ? point.color : 'transparent',
          }}
        />
      </PopoverTrigger>

      <PopoverContent side="left" align="start" className="w-44 gap-4 p-4">
        <div className="flex flex-col gap-3">
          <Eyebrow>Colour</Eyebrow>
          <div className="grid grid-cols-4 gap-1">
            {GRAPH_COLORS.map((color) => {
              const active = point.color === color;
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={`Use ${color}`}
                  aria-pressed={active}
                  onClick={() => onPatch({ color })}
                  className={cn(
                    'grid size-8 place-items-center rounded-md transition-colors duration-[80ms]',
                    active ? 'bg-subtle ring-1 ring-border-strong' : 'hover:bg-subtle',
                  )}
                >
                  <span
                    className="size-3.5 rounded-full"
                    style={{ background: color }}
                  />
                </button>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Bound number input ─────────────────────────────────────────────────── */

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
      className={cn(
        'h-7 w-12 shrink-0 px-1.5 font-mono text-xs tabular-nums',
        className,
      )}
    />
  );
}

/* ─── Point row ──────────────────────────────────────────────────────────── */

function PointRow({
  point,
  onPatch,
  onDelete,
}: {
  point: GraphPoint;
  onPatch: (patch: Partial<GraphPoint>) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState({ x: String(point.x), y: String(point.y) });

  useEffect(() => {
    setDraft({ x: String(point.x), y: String(point.y) });
  }, [point.x, point.y]);

  const commit = (key: 'x' | 'y', raw: string) => {
    const value = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(value)) onPatch({ [key]: value });
    else setDraft((d) => ({ ...d, [key]: String(point[key]) }));
  };

  return (
    <div className="group flex items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors duration-[80ms] hover:bg-subtle/60 focus-within:bg-subtle/60">
      {/* Style swatch */}
      <div className="flex w-8 shrink-0 items-center justify-center">
        <PointStylePopover point={point} onPatch={onPatch} />
      </div>

      {/* Coordinates — mono, tabular */}
      <span className="font-mono text-xs text-tertiary select-none">(</span>
      <BoundInput
        label="Point x"
        value={draft.x}
        onChange={(value) => setDraft((d) => ({ ...d, x: value }))}
        onCommit={(value) => commit('x', value)}
        className="w-14 flex-1 text-center"
      />
      <span className="font-mono text-xs text-tertiary select-none">,</span>
      <BoundInput
        label="Point y"
        value={draft.y}
        onChange={(value) => setDraft((d) => ({ ...d, y: value }))}
        onCommit={(value) => commit('y', value)}
        className="w-14 flex-1 text-center"
      />
      <span className="font-mono text-xs text-tertiary select-none">)</span>

      {/* Hover actions */}
      <div className="touch-reveal ml-auto flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[80ms] group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          aria-label={point.visible ? 'Hide point' : 'Show point'}
          aria-pressed={!point.visible}
          title={point.visible ? 'Hide point' : 'Show point'}
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={() => onPatch({ visible: !point.visible })}
        >
          {point.visible ? (
            <Eye strokeWidth={1.5} />
          ) : (
            <EyeOff strokeWidth={1.5} />
          )}
        </button>
        <button
          type="button"
          aria-label="Delete point"
          title="Delete point"
          className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
          onClick={onDelete}
        >
          <Trash2 strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}

/* ─── Slider row ─────────────────────────────────────────────────────────── */

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

  useEffect(() => setMinDraft(String(parameter.min)), [parameter.min]);
  useEffect(() => setMaxDraft(String(parameter.max)), [parameter.max]);

  const paramRef = useRef(parameter);
  paramRef.current = parameter;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Ping-pong animation over ~4 s, ~30fps writes.
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
      if (v >= p.max) { v = p.max; dir = -1; }
      else if (v <= p.min) { v = p.min; dir = 1; }
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
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-subtle/40 px-3 py-2.5">
      {/* Header: play + name + live value */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={playing ? `Pause ${name}` : `Animate ${name}`}
            aria-pressed={playing}
            title={playing ? 'Pause' : 'Animate'}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
            onClick={() => setPlaying((p) => !p)}
          >
            {playing ? (
              <Pause strokeWidth={1.5} />
            ) : (
              <Play strokeWidth={1.5} />
            )}
          </button>
          <span className="font-mono text-sm font-medium text-primary">{name}</span>
        </div>
        <span className="font-mono text-xs tabular-nums text-secondary">
          = {Number(parameter.value.toPrecision(4))}
        </span>
      </div>

      {/* Range: min input + slider + max input */}
      <div className="flex items-center gap-2">
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
    </div>
  );
}

/* ─── Viewport fields ────────────────────────────────────────────────────── */

const VIEWPORT_FIELDS: { key: keyof GraphViewport; label: string; hint: string }[] = [
  { key: 'xMin', label: 'X min', hint: 'Left bound' },
  { key: 'xMax', label: 'X max', hint: 'Right bound' },
  { key: 'yMin', label: 'Y min', hint: 'Bottom bound' },
  { key: 'yMax', label: 'Y max', hint: 'Top bound' },
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
    <div className="flex flex-col gap-3">
      <SectionHeader
        label="View range"
        action={
          <button
            type="button"
            title="Reset to default view"
            onClick={onReset}
            className={cn(
              buttonVariants({ variant: 'ghost', size: 'xs' }),
              'gap-1 text-tertiary hover:text-secondary',
            )}
          >
            <RefreshCw size={12} strokeWidth={1.5} />
            Reset
          </button>
        }
      />

      <div className="grid grid-cols-2 gap-2">
        {VIEWPORT_FIELDS.map(({ key, label }) => (
          <div key={key} className="flex items-center gap-2 rounded-md border border-border bg-subtle/40 px-2.5 py-1.5">
            <span className="w-9 shrink-0 font-mono text-2xs text-tertiary select-none">
              {label}
            </span>
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
              className="h-6 min-w-0 flex-1 border-0 bg-transparent px-0 font-mono text-xs tabular-nums shadow-none focus-visible:ring-0"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Toggle setting row ─────────────────────────────────────────────────── */

function SettingRow({
  label,
  description,
  checked,
  onCheckedChange,
  id,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-1 py-1">
      <div className="flex flex-col gap-0.5">
        <label
          htmlFor={id}
          className="cursor-pointer text-sm font-medium text-primary"
        >
          {label}
        </label>
        {description ? (
          <span className="text-2xs text-tertiary">{description}</span>
        ) : null}
      </div>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onCheckedChange}
        size="sm"
      />
    </div>
  );
}

/* ─── Hairline divider ───────────────────────────────────────────────────── */

function Divider() {
  return <div className="h-px w-full bg-border" aria-hidden="true" />;
}

/* ─── Main panel content ─────────────────────────────────────────────────── */

function GraphPanelContent({ shape }: { shape: GraphShape }) {
  const fieldRefs = useRef(new Map<string, MathfieldElement>());

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

  const patchExpression = (expressionId: string, patch: Partial<GraphExpression>) => {
    updateExpressions(
      props.expressions.map((e) =>
        e.id === expressionId ? { ...e, ...patch } : e,
      ),
    );
  };

  const addExpression = () => {
    const created = createGraphExpression(props.expressions.length);
    updateExpressions([...props.expressions, created]);
    focusField(created.id);
  };

  const insertExpressionAfter = (afterId: string) => {
    const created = createGraphExpression(props.expressions.length);
    const next = [...props.expressions];
    const index = next.findIndex((e) => e.id === afterId);
    next.splice(index + 1, 0, created);
    updateExpressions(next);
    focusField(created.id);
  };

  const deleteExpression = (expressionId: string) => {
    const next = props.expressions.filter((e) => e.id !== expressionId);
    updateExpressions(next.length ? next : [createGraphExpression(0)]);
  };

  const deleteEmptyExpression = (expressionId: string) => {
    if (props.expressions.length <= 1) return;
    const index = props.expressions.findIndex((e) => e.id === expressionId);
    const next = props.expressions.filter((e) => e.id !== expressionId);
    updateExpressions(next);
    const target = next[index - 1] ?? next[0];
    if (target) focusField(target.id);
  };

  const moveFocus = (fromId: string, direction: 'upward' | 'downward') => {
    const index = props.expressions.findIndex((e) => e.id === fromId);
    const target =
      props.expressions[direction === 'upward' ? index - 1 : index + 1];
    if (target) focusField(target.id);
  };

  const points = props.points ?? [];
  const updatePoints = (next: GraphPoint[]) => updateGraph({ points: next });

  const patchPoint = (pointId: string, patch: Partial<GraphPoint>) => {
    updatePoints(points.map((p) => (p.id === pointId ? { ...p, ...patch } : p)));
  };

  const addPoint = () => updatePoints([...points, createGraphPoint(points.length)]);

  const deletePoint = (pointId: string) =>
    updatePoints(points.filter((p) => p.id !== pointId));

  const parameterNames = Object.keys(props.parameters).sort((a, b) =>
    a.localeCompare(b),
  );

  const curveCount = props.expressions.length;
  const sliderCount = parameterNames.length;

  return (
    <Surface
      role="region"
      aria-label="Graph controls"
      className="touch-targets flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(22rem,calc(100vw-2rem))] flex-col gap-0 overflow-y-auto sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      {/* ── Panel header ────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <Eyebrow>Plotter</Eyebrow>
          <p className="font-mono text-xs text-tertiary tabular-nums">
            {curveCount} curve{curveCount === 1 ? '' : 's'}
            {sliderCount > 0
              ? ` · ${sliderCount} slider${sliderCount === 1 ? '' : 's'}`
              : ''}
          </p>
        </div>
        {/* Overflow menu placeholder — consistent with card pattern */}
        <button
          type="button"
          aria-label="More options"
          className="grid size-7 place-items-center rounded-full text-tertiary transition-colors duration-[80ms] hover:bg-subtle hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          <MoreHorizontal size={16} strokeWidth={1.5} />
        </button>
      </header>

      {/* ── Expressions ─────────────────────────────────────────────────── */}
      <section aria-label="Expressions" className="flex flex-col">
        {/* Full-bleed rows with hairline dividers — the Desmos-style list */}
        <div className="flex flex-col divide-y divide-border">
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
        </div>

        {/* ── Add curve — compound-card action strip ────────────────────── */}
        {/*
         * Compound-card footer strip (§12.6): bg-subtle/40 surface, border-t,
         * padding-x must equal the body's px-5 so content shares one vertical
         * rule. Height 44 px. Primary action last/rightmost (§12.6 toolbar order).
         * r_inner not needed here — the strip is flush to the card edge (§7.3).
         */}
        <button
          type="button"
          onClick={addExpression}
          aria-label="Add curve"
          className="group/add-curve flex h-11 w-full items-center gap-3 border-t border-border bg-subtle/40 px-5 text-left transition-colors duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)] hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset"
        >
          {/*
           * Icon chip — 20×20 px, rounded-md (md=8). Sits inside px-5 so the
           * inner radius follows §7.3: strip has no explicit outer radius (it's
           * flush), so any self-contained affordance chip uses its own radius.
           * Background steps up from subtle/40 → subtle on hover via the parent
           * group state, so the chip reads as "lifted" on rest and "flush" on hover.
           */}
          <span
            className="grid size-5 shrink-0 place-items-center rounded-md bg-muted text-tertiary transition-colors duration-[80ms] group-hover/add-curve:bg-border group-hover/add-curve:text-secondary"
            aria-hidden="true"
          >
            <Plus size={12} strokeWidth={2} />
          </span>

          {/* Label — body-sm, tertiary at rest → secondary on hover */}
          <span className="flex-1 text-sm font-medium text-tertiary transition-colors duration-[80ms] group-hover/add-curve:text-secondary">
            Add curve
          </span>

          {/*
           * Keyboard hint — Enter inserts a new curve from the focused math
           * field. Keycap style per §12.2 hero-field: mono, 2xs, rounded-sm
           * border chip, 20 px tall. Hidden on touch (no keyboard shortcut).
           */}
          <kbd
            className="hidden items-center gap-0.5 sm:flex"
            aria-label="Keyboard shortcut: Enter"
          >
            <span className="flex h-5 min-w-5 items-center justify-center rounded-sm border border-border bg-surface px-1 font-mono text-2xs text-tertiary">
              ⏎
            </span>
          </kbd>
        </button>
      </section>

      <Divider />

      {/* ── Points ──────────────────────────────────────────────────────── */}
      {/*
       * Compound-card pattern (§12.6): wrapper owns the border and radius;
       * the toolbar strip owns only its border-b. The wrapper uses rounded-lg
       * (12 px) matching the tile density (§12.5). The section sits inside
       * px-5 py-4 padding from the parent, so the compound card is inset.
       * Strip height 44–52 px; padding-x must match the body padding (px-4)
       * so all content aligns on one vertical rule.
       */}
      <section aria-label="Points" className="flex flex-col gap-3 px-5 py-4">
        {/*
         * Toolbar strip — compound card header (§12.6).
         * Order L→R: eyebrow title · count badge · [spacer] · primary action.
         * Primary action is last/rightmost per toolbar order rule.
         * Strip uses bg-subtle/40 to read as a "laminated" different surface.
         * r_inner = r_outer(12) − padding(0) = 12 for top corners; flush
         * bottom means rounded-b-none. overflow-hidden on wrapper clips it.
         */}
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          {/* Strip header */}
          <div className="flex items-center gap-2 border-b border-border bg-subtle/40 px-4 py-2.5">
            {/* Eyebrow (§5.3) — mono uppercase tracking, fg-muted, max 3 words */}
            <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-tertiary">
              Points
            </span>

            {/* Count badge (§12.4) — bg-inverse text-inverse, h-5 min-w-5,
             *  rounded-full, text-2xs tabular-nums, centred.
             *  Only shown when there is at least one point. */}
            {points.length > 0 && (
              <span
                className="flex h-5 min-w-5 items-center justify-center rounded-full bg-muted px-1.5 font-mono text-2xs tabular-nums text-tertiary"
                aria-label={`${points.length} point${points.length === 1 ? '' : 's'}`}
              >
                {points.length}
              </span>
            )}

            <span className="flex-1" aria-hidden="true" />

            {/*
             * Add point — secondary (outline) button, sm size (h-8, px-2.5).
             * Secondary variant: bg-subtle border-border text-primary hover:bg-muted.
             * This is the one committing action in this strip (P3 — weight earned).
             * Label: sentence case verb phrase, 2 words (§12.1 button rules).
             * Leading icon only (§12.1).
             */}
            <button
              type="button"
              onClick={addPoint}
              className={cn(
                buttonVariants({ variant: 'outline', size: 'sm' }),
                'gap-1.5',
              )}
            >
              <Plus size={13} strokeWidth={1.75} aria-hidden="true" />
              Add point
            </button>
          </div>

          {/* Card body — points list or empty state */}
          <div className="px-3 py-2">
            {points.length > 0 ? (
              /*
               * Point rows — gap-1 per the proximity-halves rule (§6.2):
               * in-group gap is 4 px, between strip and body gap is implied
               * by the px-3 py-2 padding. No extra padding on rows (§9.4:
               * card owns its padding, children own none).
               */
              <div className="flex flex-col gap-0.5">
                {points.map((point) => (
                  <PointRow
                    key={point.id}
                    point={point}
                    onPatch={(patch) => patchPoint(point.id, patch)}
                    onDelete={() => deletePoint(point.id)}
                  />
                ))}
              </div>
            ) : (
              /*
               * Empty state (§12.5): centred, py-8, muted icon 18 px, one
               * body-sm medium line, one caption fg-muted line. No button —
               * the add action lives in the header strip.
               */
              <div className="flex flex-col items-center gap-1.5 py-6 text-center">
                <span className="grid size-8 place-items-center rounded-lg bg-subtle text-tertiary">
                  <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
                </span>
                <p className="text-sm font-medium text-secondary">No points yet</p>
                <p className="max-w-[28ch] font-mono text-2xs text-tertiary">
                  Pin exact coordinates on the graph
                </p>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Sliders (only when expressions reference free parameters) ───── */}
      {parameterNames.length > 0 && (
        <>
          <Divider />
          <section aria-label="Sliders" className="flex flex-col gap-3 px-5 py-4">
            <SectionHeader label="Sliders" />
            <div className="flex flex-col gap-2">
              {parameterNames.map((name) => {
                const parameter = props.parameters[name]!;
                return (
                  <SliderRow
                    key={name}
                    name={name}
                    parameter={parameter}
                    onChange={(next) =>
                      updateGraph({
                        parameters: { ...props.parameters, [name]: next },
                      })
                    }
                  />
                );
              })}
            </div>
          </section>
        </>
      )}

      <Divider />

      {/* ── View range ──────────────────────────────────────────────────── */}
      <section aria-label="View range" className="px-5 py-4">
        <ViewRange
          viewport={props.viewport}
          onChange={(viewport) => updateGraph({ viewport })}
          onReset={() => updateGraph({ viewport: { ...DEFAULT_GRAPH_VIEWPORT } })}
        />
      </section>

      <Divider />

      {/* ── Display settings ────────────────────────────────────────────── */}
      <section aria-label="Display settings" className="flex flex-col gap-1 px-5 py-4">
        <SectionHeader label="Display" />
        <div className="mt-2 flex flex-col gap-1">
          <SettingRow
            id="graph-axis-labels"
            label="Axis numbers"
            description="Show numeric labels on the x and y axes"
            checked={showAxisLabels}
            onCheckedChange={(checked) => updateGraph({ showAxisLabels: checked })}
          />
          <SettingRow
            id="graph-show-intersections"
            label="Intersections"
            description="Mark where curves cross each other"
            checked={props.showIntersections === true}
            onCheckedChange={(checked) =>
              updateGraph({ showIntersections: checked })
            }
          />
        </div>
      </section>

      {/* ── Info footer ─────────────────────────────────────────────────── */}
      <footer className="flex items-center gap-2 border-t border-border px-5 py-3">
        <Info size={12} strokeWidth={1.5} className="shrink-0 text-tertiary" />
        <p className="font-mono text-2xs text-tertiary">
          Type <span className="font-medium text-secondary">y=f(x)</span> or
          implicit equations like{' '}
          <span className="font-medium text-secondary">x²+y²=4</span>
        </p>
      </footer>
    </Surface>
  );
}

/* ─── Public export ──────────────────────────────────────────────────────── */

export function GraphPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Subscribe to the one selected shape, not the whole page record — the record
  // is a fresh object on every mutation, which would re-render on every stroke.
  const selectedShape = useDocumentStore((s) =>
    selectedId ? s.doc.pages[s.currentPageId]?.shapes[selectedId] : undefined,
  );
  const graphShape =
    selectedShape?.type === 'graph' ? selectedShape : undefined;
  const panelVisible = Boolean(graphShape);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && graphShape ? (
        <GraphPanelContent shape={graphShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
