import { useMemo, useRef } from 'react';
import type { MathfieldElement } from 'mathlive';
import { ChevronDown, Plus } from 'lucide-react';
import type {
  GraphExpression,
  GraphProps,
  GraphShape,
} from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { createGraphExpression } from '@/canvas/graph-defaults';
import {
  graphParametersEqual,
  reconcileGraphParameters,
} from '@/canvas/graph-parameters';
import { createGraphFunctionDefinitions } from '@/canvas/graph-parser';
import { GRAPH_3D_PRESETS, GRAPH_MATH_PRESETS } from '@/canvas/graph-presets';
import { fitViewport, graphAxes, type GraphAxes } from '@/canvas/graph-scale';
import { plotsTrig, usesAngles } from '@/canvas/graph-ticks';
import { DEFAULT_GRAPH_3D_ANGLE } from '@/canvas/graph3d';
import { editor } from '@/canvas/use-document-store';
import { useShape } from '@/canvas/use-shapes';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { DisplaySettings } from './graph-display-settings';
import { ExpressionRow } from './graph-expression-row';
import { SECTION } from './graph-panel-styles';
import { SliderRow } from './graph-slider-row';
import { ViewRange } from './graph-view-range';
import { Graph3dRange } from './graph-view-range-3d';

export function GraphPanelContent({ shape }: { shape: GraphShape }) {
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
  const axes = graphAxes(props);
  const angleUnit = props.angleUnit ?? 'rad';
  const view3d = props.view3d;
  const threeD = view3d !== undefined;
  const functionDefinitions = useMemo(
    () => createGraphFunctionDefinitions(props.expressions, angleUnit),
    [props.expressions, angleUnit],
  );

  const updateGraph = (patch: Partial<GraphProps>) => {
    editor.updateShape(shape.id, { props: patch });
  };

  const updateExpressions = (expressions: GraphExpression[]) => {
    const parameters = reconcileGraphParameters(expressions, props.parameters, threeD);
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

  const addExpression = (latex?: string) => {
    const created = createGraphExpression(props.expressions.length);
    if (latex !== undefined) created.expression = latex;
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

  const setScale = (axis: 'x' | 'y', scale: GraphAxes['x']) => {
    const next = { ...axes, [axis]: scale };
    updateGraph({
      [axis === 'x' ? 'xScale' : 'yScale']: scale,
      viewport: fitViewport(props.viewport, next),
    });
  };

  // A trig plot keeps its shape across the switch: the window and any angle
  // domain are rescaled with it, so sin(x) over [−2π, 2π] lands on
  // [−360, 360] rather than flattening into a sliver. One undo step.
  const setAngleUnit = (unit: 'rad' | 'deg') => {
    if (unit === angleUnit) return;
    const k = unit === 'deg' ? 180 / Math.PI : Math.PI / 180;
    const scaled = (v: number) => Number((v * k).toPrecision(12));
    const patch: Partial<GraphProps> = { angleUnit: unit };
    if (axes.x === 'linear' && plotsTrig(props.expressions)) {
      patch.viewport = {
        ...props.viewport,
        xMin: scaled(props.viewport.xMin),
        xMax: scaled(props.viewport.xMax),
      };
    }
    if (props.expressions.some((e) => e.domain && usesAngles(e.expression))) {
      patch.expressions = props.expressions.map((e) =>
        e.domain && usesAngles(e.expression)
          ? { ...e, domain: { min: scaled(e.domain.min), max: scaled(e.domain.max) } }
          : e,
      );
    }
    updateGraph(patch);
  };

  // The rows stay as typed and the sliders are re-read for the new mode: in
  // 2D a `z` is a slider, in 3D an axis. z starts on y's range, so a square
  // window opens as a cube.
  const setThreeD = (next: boolean) => {
    if (next === threeD) return;
    const parameters = reconcileGraphParameters(props.expressions, props.parameters, next);
    updateGraph({
      view3d: next
        ? { ...DEFAULT_GRAPH_3D_ANGLE, zMin: props.viewport.yMin, zMax: props.viewport.yMax }
        : undefined,
      ...(graphParametersEqual(parameters, props.parameters) ? {} : { parameters }),
    });
  };

  const presets = view3d ? GRAPH_3D_PRESETS : GRAPH_MATH_PRESETS;
  const parameterNames = Object.keys(props.parameters).sort((a, b) =>
    a.localeCompare(b),
  );

  // One surface, top to bottom in the order you reach for things: what is
  // plotted, what moves it, where you are looking, how it is drawn. Groups
  // are ruled off by hairlines, never boxed. Only the first two scroll.
  return (
    <TooltipProvider delay={300}>
      <Surface
        role="region"
        aria-label="Graph"
        className="touch-targets flex max-h-[min(var(--anchor-max-h,calc(100dvh-2rem)),32rem)] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden border-0 bg-[var(--ds-surface-overlay)] p-0 [--chrome-hover:var(--color-tb-track)]"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <ul aria-label="Expressions" className="flex flex-col gap-1 px-2 pt-2">
            {props.expressions.map((expression, index) => (
              <li key={expression.id}>
                <ExpressionRow
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
                  angleUnit={angleUnit}
                  threeD={threeD}
                />
              </li>
            ))}
          </ul>

          {/* Adding sits where the next row would be. */}
          <div className="flex items-center gap-1 px-2 pt-1 pb-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => addExpression()}
              className="h-8 flex-1 justify-start gap-2 px-2 text-sm font-medium text-fg-muted"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add expression
            </Button>
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DropdownMenuTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Examples"
                          className="text-fg-muted"
                        >
                          <ChevronDown className="size-4" aria-hidden="true" />
                        </Button>
                      }
                    />
                  }
                />
                <TooltipContent side="top">Examples</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end" className="w-56 p-1">
                {presets.map((preset) => (
                  <DropdownMenuItem
                    key={preset.name}
                    onClick={() => addExpression(preset.expression)}
                    className="flex items-center justify-between gap-3"
                  >
                    <span>{preset.name}</span>
                    <span className="truncate font-mono text-2xs text-fg-subtle">
                      {preset.expression}
                    </span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {parameterNames.length > 0 && (
            <ul aria-label="Sliders" className={SECTION}>
              {parameterNames.map((name) => (
                <li key={name}>
                  <SliderRow
                    shapeId={shape.id}
                    name={name}
                    parameter={props.parameters[name]!}
                    onChange={(next) =>
                      updateGraph({
                        parameters: { ...props.parameters, [name]: next },
                      })
                    }
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Pinned below the scroller with the display settings: the view
            controls stay in reach however many rows there are. */}
        <section aria-label="View" className={`${SECTION} shrink-0`}>
          {view3d ? (
            <Graph3dRange viewport={props.viewport} view3d={view3d} onChange={updateGraph} />
          ) : (
            <ViewRange
              viewport={props.viewport}
              shapeProps={{ w: props.w, h: props.h }}
              axes={axes}
              angleUnit={angleUnit}
              onChange={(viewport) => updateGraph({ viewport })}
              onScaleChange={setScale}
            />
          )}
        </section>

        <DisplaySettings
          threeD={threeD}
          onThreeD={setThreeD}
          showAxisLabels={props.showAxisLabels !== false}
          showIntersections={props.showIntersections === true}
          angleUnit={angleUnit}
          onAngleUnit={setAngleUnit}
          onPatch={updateGraph}
        />
      </Surface>
    </TooltipProvider>
  );
}

export function GraphPanel() {
  const selectedIds = useSelectionStore((s) => s.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  const selectedShape = useShape(selectedId);
  const graphShape =
    selectedShape?.type === 'graph' ? selectedShape : undefined;
  const panelVisible = Boolean(graphShape);

  return (
    <ToolPanelPresence visible={panelVisible} anchorShapeId={graphShape?.id ?? null}>
      {panelVisible && graphShape ? (
        <GraphPanelContent shape={graphShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
