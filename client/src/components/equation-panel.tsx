import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import type { EquationShape } from '@whiteboard/shared';
import { useAnimationStore } from '@/animation/use-animation-store';
import {
  ensureMathJax,
  getEquationRender,
  typesetEquation,
  useEquationRenderStore,
  type EquationRender,
} from '@/canvas/equation-render';
import { GRAPH_COLORS } from '@/canvas/graph-expressions';
import { EQUATION_DEFAULT_SIZE } from '@/canvas/shapes/equation';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { MathField } from '@/components/ui/math-field';
import { PanelLabel } from '@/components/ui/panel-label';
import { Surface } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function patchEquationFromRender(
  shapeId: string,
  latex: string,
  render: EquationRender,
): void {
  const current = editor.getShape(shapeId);
  if (!current || current.type !== 'equation') return;
  if ('error' in render) {
    editor.updateShape(shapeId, { props: { latex } });
    return;
  }
  const scale = current.props.fontSize / 16;
  editor.updateShape(shapeId, {
    props: {
      latex,
      w: render.width * scale,
      h: render.height * scale,
    },
  });
}

function EquationPanelContent({ shape }: { shape: EquationShape }) {
  const fieldRef = useRef<MathfieldElement | null>(null);
  const inputVersion = useRef(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEquationRenderStore((state) => state.version);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadError(null);
    void ensureMathJax()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : 'The equation renderer could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  // Focus after both MathLive and the lazily-loaded renderer are ready, then
  // keep the math keyboard open for the lifetime of this contextual panel.
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const focusField = (tries: number) => {
      if (fieldRef.current) {
        fieldRef.current.focus();
        window.mathVirtualKeyboard.show({ animate: true });
      } else if (tries > 0) {
        frame = requestAnimationFrame(() => focusField(tries - 1));
      }
    };
    frame = requestAnimationFrame(() => focusField(5));
    return () => {
      cancelAnimationFrame(frame);
      window.mathVirtualKeyboard.hide({ animate: false });
    };
  }, [ready, shape.id]);

  const settledLatex = useDebouncedValue(shape.props.latex, 500);
  const settledKey = settledLatex.trim();
  const settledRender = settledKey
    ? getEquationRender(settledKey)
    : undefined;
  const renderError =
    settledLatex === shape.props.latex ? settledRender?.error : undefined;
  const error = loadError ?? renderError ?? null;

  const updateLatex = (latex: string) => {
    const version = ++inputVersion.current;
    const key = latex.trim();
    if (!key) {
      editor.updateShape(shape.id, {
        props: {
          latex,
          w: EQUATION_DEFAULT_SIZE.w,
          h: EQUATION_DEFAULT_SIZE.h,
        },
      });
      return;
    }

    // The ready gate means this normally fills the cache synchronously, letting
    // one document patch carry source and measured geometry per keystroke.
    const pending = typesetEquation(key);
    const immediate = getEquationRender(key);
    if (immediate) {
      patchEquationFromRender(shape.id, latex, immediate);
      return;
    }
    void pending.then((render) => {
      if (version === inputVersion.current) {
        patchEquationFromRender(shape.id, latex, render);
      }
    });
  };

  return (
    <Surface
      role="region"
      aria-label="Equation controls"
      className="touch-targets flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto p-4 shadow-floating sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      <div className="min-w-0">
        <div className="text-sm font-semibold text-content-emphasis">
          Equation
        </div>
        <div className="text-xs text-content-subtle">
          {loadError
            ? 'Renderer unavailable'
            : ready
              ? 'Display LaTeX'
              : 'Loading equation renderer…'}
        </div>
      </div>

      <FieldGroup className="gap-2">
        <Field
          data-invalid={error ? true : undefined}
          data-disabled={!ready ? true : undefined}
        >
          <FieldLabel htmlFor={`equation-${shape.id}`}>Formula</FieldLabel>
          <div
            className={cn(
              'rounded-md border border-border-subtle bg-bg-muted px-1 py-2 transition-[background-color,border-color,box-shadow] duration-150',
              'focus-within:border-border-emphasis focus-within:ring-2 focus-within:ring-border-emphasis',
              'group-data-[invalid]/field:border-content-error group-data-[invalid]/field:ring-2 group-data-[invalid]/field:ring-content-error/20',
            )}
          >
            <MathField
              id={`equation-${shape.id}`}
              aria-label="LaTeX equation"
              aria-invalid={error ? true : undefined}
              className="w-full"
              value={shape.props.latex}
              format="latex"
              virtualKeyboardPolicy="manual"
              placeholder="Type an equation…"
              disabled={!ready}
              elementRef={(element) => {
                fieldRef.current = element;
              }}
              onChange={updateLatex}
            />
          </div>
          {error ? <FieldError>{error}</FieldError> : null}
        </Field>
      </FieldGroup>

      <div className="flex flex-col gap-1.5">
        <PanelLabel>Color</PanelLabel>
        <div
          role="group"
          aria-label="Equation color"
          className="grid grid-cols-4 gap-1"
        >
          {GRAPH_COLORS.map((color) => {
            const active = shape.props.color === color;
            return (
              <button
                key={color}
                type="button"
                aria-label={`Use ${color}`}
                aria-pressed={active}
                onClick={() =>
                  editor.updateShape(shape.id, { props: { color } })
                }
                className={cn(
                  'flex size-8 items-center justify-center rounded-md transition-colors',
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
    </Surface>
  );
}

export function EquationPanel() {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Subscribe to the one selected shape, not the whole page record — see the
  // same note in graph-panel.tsx.
  const selectedShape = useDocumentStore((state) =>
    selectedId
      ? state.doc.pages[state.currentPageId]?.shapes[selectedId]
      : undefined,
  );
  const playbackActive = useAnimationStore((state) => state.playbackActive);
  const equationShape =
    selectedShape?.type === 'equation' ? selectedShape : undefined;
  const panelVisible = !playbackActive && Boolean(equationShape);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && equationShape ? (
        <EquationPanelContent shape={equationShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
