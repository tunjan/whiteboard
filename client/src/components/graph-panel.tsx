import { useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, RotateCcw, Trash2 } from 'lucide-react';
import type {
  GraphExpression,
  GraphParameter,
  GraphProps,
  GraphViewport,
  StrokeDash,
} from '@whiteboard/shared';
import { Button, buttonVariants } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  DEFAULT_GRAPH_VIEWPORT,
  GRAPH_COLORS,
  createGraphExpression,
  parseGraphExpression,
  reconcileGraphParameters,
} from '@/canvas/graph-expressions';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { cn } from '@/lib/utils';

const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];

function valueFromSlider(value: number | number[]): number {
  return Array.isArray(value) ? value[0]! : value;
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

function expressionError(expression: GraphExpression): string | null {
  if (!expression.expression.trim()) return null;
  const parsed = parseGraphExpression(expression.expression);
  return parsed.ok ? null : parsed.message;
}

function ColorPicker({
  expression,
  onColorChange,
}: {
  expression: GraphExpression;
  onColorChange: (color: string) => void;
}) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label="Curve color"
        className="flex size-6 items-center justify-center rounded-md transition-colors hover:bg-muted"
      >
        <span
          className="size-3.5 rounded-full border border-foreground/15"
          style={{ background: expression.color }}
        />
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-44">
        <PopoverTitle>Curve color</PopoverTitle>
        <div role="group" aria-label="Curve color" className="grid grid-cols-6 gap-1">
          {GRAPH_COLORS.map((color) => {
            const active = expression.color === color;
            return (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                aria-pressed={active}
                onClick={() => onColorChange(color)}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md transition-colors',
                  active ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <span
                  className="size-3.5 rounded-full border border-foreground/15"
                  style={{ background: color }}
                />
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
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
  return (
    <Field>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel className="font-mono">{name}</FieldLabel>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {Number(parameter.value.toPrecision(4))}
        </span>
      </div>
      <Slider
        aria-label={name}
        min={parameter.min}
        max={parameter.max}
        step={parameter.step}
        value={parameter.value}
        onValueChange={(value) =>
          onChange({ ...parameter, value: valueFromSlider(value) })
        }
      />
      <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
        <span>{parameter.min}</span>
        <span>{parameter.max}</span>
      </div>
    </Field>
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
}: {
  viewport: GraphViewport;
  onChange: (viewport: GraphViewport) => void;
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
      <div className="text-sm font-medium leading-none text-foreground select-none">
        View range
      </div>
      <div className="grid grid-cols-2 gap-2">
        {VIEWPORT_FIELDS.map(({ key, label }) => (
          <Field key={key} orientation="horizontal" className="gap-2">
            <FieldLabel className="w-10 shrink-0 text-xs text-muted-foreground">
              {label}
            </FieldLabel>
            <Input
              type="number"
              inputMode="decimal"
              aria-label={label}
              value={draft[key]}
              onChange={(event) =>
                setDraft((d) => ({ ...d, [key]: event.currentTarget.value }))
              }
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

export function GraphPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const shapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const shape = selectedId ? shapesRecord?.[selectedId] : undefined;

  if (!shape || shape.type !== 'graph') return null;

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
    updateExpressions([
      ...props.expressions,
      createGraphExpression(props.expressions.length),
    ]);
  };

  const deleteExpression = (expressionId: string) => {
    const next = props.expressions.filter((expression) => expression.id !== expressionId);
    updateExpressions(next.length ? next : [createGraphExpression(0)]);
  };

  const parameterNames = Object.keys(props.parameters).sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <Surface className="touch-targets absolute top-[calc(4.5rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] z-20 flex max-h-[calc(100dvh-7rem-env(safe-area-inset-top))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto p-3.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">Function</div>
          <div className="text-xs text-muted-foreground">
            {props.expressions.length} curve{props.expressions.length === 1 ? '' : 's'}
          </div>
        </div>
        <Button
          variant="outline"
          size="xs"
          onClick={() => updateGraph({ viewport: { ...DEFAULT_GRAPH_VIEWPORT } })}
        >
          <RotateCcw data-icon="inline-start" />
          Reset
        </Button>
      </div>

      <Separator />

      <Field orientation="horizontal">
        <FieldLabel>Axis numbers</FieldLabel>
        <ToggleGroup
          aria-label="Axis numbers"
          className="w-28"
          value={[showAxisLabels ? 'on' : 'off']}
          onValueChange={(value) => {
            const next = value[0];
            if (next) updateGraph({ showAxisLabels: next === 'on' });
          }}
        >
          <ToggleGroupItem value="on">On</ToggleGroupItem>
          <ToggleGroupItem value="off">Off</ToggleGroupItem>
        </ToggleGroup>
      </Field>

      <Separator />

      <ViewRange
        viewport={props.viewport}
        onChange={(viewport) => updateGraph({ viewport })}
      />

      <Separator />

      <FieldGroup className="gap-3">
        {props.expressions.map((expression, index) => {
          const error = expressionError(expression);
          return (
            <Field key={expression.id} data-invalid={error ? true : undefined}>
              <FieldLabel className="sr-only" htmlFor={`graph-expression-${expression.id}`}>
                Expression {index + 1}
              </FieldLabel>
              <InputGroup aria-invalid={error ? true : undefined}>
                <InputGroupAddon>
                  <ColorPicker
                    expression={expression}
                    onColorChange={(color) =>
                      patchExpression(expression.id, { color })
                    }
                  />
                </InputGroupAddon>
                <InputGroupInput
                  id={`graph-expression-${expression.id}`}
                  aria-invalid={error ? true : undefined}
                  value={expression.expression}
                  placeholder="y = sin(x)"
                  onChange={(event) =>
                    patchExpression(expression.id, {
                      expression: event.currentTarget.value,
                    })
                  }
                />
                <InputGroupAddon className="gap-1">
                  <button
                    type="button"
                    aria-label={expression.visible ? 'Hide curve' : 'Show curve'}
                    className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
                    onClick={() =>
                      patchExpression(expression.id, {
                        visible: !expression.visible,
                      })
                    }
                  >
                    {expression.visible ? <Eye /> : <EyeOff />}
                  </button>
                  <button
                    type="button"
                    aria-label="Delete curve"
                    className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }))}
                    onClick={() => deleteExpression(expression.id)}
                  >
                    <Trash2 />
                  </button>
                </InputGroupAddon>
              </InputGroup>

              <ToggleGroup
                aria-label={`Line style for expression ${index + 1}`}
                value={[expression.dash]}
                onValueChange={(value) => {
                  const dash = value[0] as StrokeDash | undefined;
                  if (dash) patchExpression(expression.id, { dash });
                }}
              >
                {DASHES.map((dash) => (
                  <ToggleGroupItem key={dash} value={dash} title={dash}>
                    <DashPreview dash={dash} />
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>

              {error ? (
                <div className="text-xs font-medium text-destructive">{error}</div>
              ) : null}
            </Field>
          );
        })}
      </FieldGroup>

      <Button variant="outline" size="sm" onClick={addExpression}>
        <Plus data-icon="inline-start" />
        Add curve
      </Button>

      {parameterNames.length > 0 ? (
        <>
          <Separator />
          <FieldGroup className="gap-3">
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
        </>
      ) : null}
    </Surface>
  );
}
