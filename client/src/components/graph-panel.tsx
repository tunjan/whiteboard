import { useMemo, useRef } from 'react';
import type { MathfieldElement } from 'mathlive';
import { ChevronDown, Plus, Sparkles } from 'lucide-react';
import type {
  GraphExpression,
  GraphProps,
  GraphShape,
} from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Surface } from '@/components/ui/surface';
import { createGraphExpression } from '@/canvas/graph-defaults';
import {
  graphParametersEqual,
  reconcileGraphParameters,
} from '@/canvas/graph-parameters';
import { createGraphFunctionDefinitions } from '@/canvas/graph-parser';
import { GRAPH_MATH_PRESETS } from '@/canvas/graph-presets';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { DisplaySettings } from './graph-display-settings';
import { ExpressionRow } from './graph-expression-row';
import { SliderRow } from './graph-slider-row';
import { ViewRange } from './graph-view-range';

/* ─── Main panel content ─────────────────────────────────────────────────── */

function GraphPanelContent({ shape }: { shape: GraphShape }) {
  const fieldRefs = useRef(new Map<string, MathfieldElement>());

  const focusField = (id: string, tries = 5) => {
    const el = fieldRefs.current.get(id);
    if (el) el.focus();
    else if (tries > 0) requestAnimationFrame(() => focusField(id, tries - 1));
  };

  const releaseFocus = () => {
    fieldRefs.current.forEach((field) => field.blur());
    window.mathVirtualKeyboard.hide({ animate: true });
  };

  const props = shape.props;
  const showAxisLabels = props.showAxisLabels !== false;
  const functionDefinitions = useMemo(
    () => createGraphFunctionDefinitions(props.expressions),
    [props.expressions],
  );

  const updateGraph = (patch: Partial<GraphProps>) => {
    editor.updateShape(shape.id, { props: patch });
  };

  const updateExpressions = (expressions: GraphExpression[]) => {
    const parameters = reconcileGraphParameters(expressions, props.parameters);
    // Most edits don't change which sliders exist, and writing an identical
    // parameter set back would rewrite that whole field of the shape for every
    // keystroke.
    updateGraph(
      graphParametersEqual(parameters, props.parameters)
        ? { expressions }
        : { expressions, parameters },
    );
  };

  const patchExpression = (
    expressionId: string,
    patch: Partial<GraphExpression>,
  ) => {
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

  const addExpressionWithPreset = (latex: string) => {
    const created = createGraphExpression(props.expressions.length);
    created.expression = latex;
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

  const parameterNames = Object.keys(props.parameters).sort((a, b) =>
    a.localeCompare(b),
  );

  const expressionCount = props.expressions.length;
  const functionMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            className="h-9.5 shrink-0 gap-1.5 rounded-lg px-3"
            aria-label="Curve presets"
            title="Curve presets"
          >
            <Sparkles className="size-4" data-icon="inline-start" aria-hidden="true" />
            <ChevronDown className="size-3.5 opacity-60" data-icon="inline-end" aria-hidden="true" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-44 p-1 shadow-e3">
        <DropdownMenuGroup>
          {GRAPH_MATH_PRESETS.map((preset) => (
            <DropdownMenuItem
              key={preset.name}
              onClick={() => addExpressionWithPreset(preset.expression)}
            >
              {preset.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <Surface
      role="region"
      aria-labelledby="graph-panel-title"
      className="flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(24rem,calc(100vw-2rem))] flex-col gap-3.5 overflow-y-auto overscroll-contain p-3.5 shadow-e2 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      <h2 id="graph-panel-title" className="sr-only">
        Graph
      </h2>
      <p className="sr-only">
        {expressionCount} {expressionCount === 1 ? 'curve' : 'curves'}
      </p>

      {/* ─── Expressions Card ──────────────────────────────────────────────── */}
      <section aria-label="Expressions" className="flex flex-col gap-2">
        <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
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
              onEscape={releaseFocus}
              registerField={(el) => {
                if (el) fieldRefs.current.set(expression.id, el);
                else fieldRefs.current.delete(expression.id);
              }}
              definitions={functionDefinitions}
            />
          ))}
        </div>
        <div className="flex items-center gap-2">
          {functionMenu}
          <Button
            type="button"
            variant="outline"
            aria-label="Add expression"
            title="Add expression"
            onClick={addExpression}
            className="h-9.5 flex-1 justify-center gap-2 rounded-lg text-sm font-medium"
          >
            <Plus className="size-4" data-icon="inline-start" aria-hidden="true" />
            <span>Add Curve</span>
          </Button>
        </div>
      </section>

      {/* ─── Parameters / Sliders ──────────────────────────────────────────── */}
      {parameterNames.length > 0 && (
        <section aria-label="Sliders" className="flex flex-col gap-2">
          <div className="flex flex-col divide-y divide-border/60 overflow-hidden rounded-xl border border-border bg-surface shadow-e1">
            {parameterNames.map((name) => {
              const parameter = props.parameters[name]!;
              return (
                <SliderRow
                  key={name}
                  shapeId={shape.id}
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
      )}

      {/* ─── Viewport & Framing ────────────────────────────────────────────── */}
      <section aria-label="Viewport framing" className="flex flex-col gap-1.5">
        <ViewRange
          viewport={props.viewport}
          shapeProps={{ w: props.w, h: props.h }}
          onChange={(viewport) => updateGraph({ viewport })}
        />
      </section>

      {/* ─── Display Settings ──────────────────────────────────────────────── */}
      <section aria-label="Display toggles">
        <DisplaySettings
          showAxisLabels={showAxisLabels}
          showIntersections={props.showIntersections === true}
          onPatch={updateGraph}
        />
      </section>
    </Surface>
  );
}

/* ─── Public export ──────────────────────────────────────────────────────── */

export function GraphPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedShape = useDocumentStore((s) =>
    selectedId ? s.shapesById.get(selectedId) : undefined,
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
