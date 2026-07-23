import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { Keyboard, Maximize2 } from 'lucide-react';
import type { EquationShape } from '@whiteboard/shared';
import { useAnimationStore } from '@/animation/use-animation-store';
import { requestCanvasZoomToBounds } from '@/canvas/camera-requests';
import {
  consumeEquationFocus,
  subscribeEquationFocus,
} from '@/canvas/equation-focus';
import {
  ensureMathJax,
  getEquationRender,
  typesetEquation,
  useEquationRenderStore,
  type EquationRender,
} from '@/canvas/equation-render';
import { EQUATION_DEFAULT_SIZE } from '@/canvas/shapes/equation';
import { shapeRotatedBounds } from '@/canvas/shape-bounds';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { MathField } from '@/components/ui/math-field';
import { Kbd } from '@/components/ui/kbd';
import { PanelLabel } from '@/components/ui/panel-label';
import { Surface } from '@/components/ui/surface';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// Every heading below the panel title sits at one weight, so the eye ranks
// title → tabs → sections instead of treating field labels as a second title.
const SECTION_LABEL = 'text-xs font-medium text-muted-foreground';

type EquationInputMode = 'visual' | 'source';

const LONG_EQUATION_SOURCE_LENGTH = 240;
const LONG_EQUATION_RENDER_DELAY_MS = 120;
const LONG_EQUATION_WARNING_WIDTH = 1200;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/** A touch/pen-primary device, where a math keyboard is the only way to type. */
function prefersVirtualKeyboard(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * MathJax's messages are written for TeX authors. Rewrite the few that a
 * whiteboard user actually hits; pass anything else through.
 */
function readableError(message: string): string {
  const unknown = /undefined control sequence:?\s*(\\[a-zA-Z@]+)/i.exec(message);
  if (unknown) return `Unknown command ${unknown[1]} — check the spelling.`;
  if (/(missing|extra).*(brace|\{|\})/i.test(message)) {
    return 'Unbalanced braces — every { needs a matching }.';
  }
  if (/missing.*\\(right|left)|extra.*\\(right|left)/i.test(message)) {
    return 'Unbalanced \\left and \\right.';
  }
  return message;
}

/**
 * Resize around the box center. Anchoring to the top-left instead would make
 * the formula creep right and down with every character typed, and centers are
 * also the pivot the rotation transform uses.
 */
function centeredMove(
  shape: EquationShape,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: shape.x + (shape.props.w - w) / 2,
    y: shape.y + (shape.props.h - h) / 2,
  };
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
  const w = render.width * scale;
  const h = render.height * scale;
  editor.updateShape(shapeId, {
    ...centeredMove(current, w, h),
    props: { latex, w, h },
  });
}

function EquationPanelContent({ shape }: { shape: EquationShape }) {
  const fieldRef = useRef<MathfieldElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const inputVersion = useRef(0);
  const longRenderTimer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [inputMode, setInputMode] = useState<EquationInputMode>('visual');
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

  // Focus both freshly placed and already-selected equations on request. Only
  // touch-primary devices open the virtual keyboard automatically.
  useEffect(() => {
    let frame = 0;
    const focusField = (tries: number) => {
      const target =
        inputMode === 'source' ? sourceRef.current : fieldRef.current;
      if (target) {
        target.focus();
        if (inputMode === 'visual' && prefersVirtualKeyboard()) {
          window.mathVirtualKeyboard.show({ animate: true });
        }
      } else if (tries > 0) {
        frame = requestAnimationFrame(() => focusField(tries - 1));
      }
    };
    const handleFocusRequest = (id: string) => {
      if (id !== shape.id || !consumeEquationFocus(id)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => focusField(5));
    };
    const unsubscribe = subscribeEquationFocus(handleFocusRequest);
    if (consumeEquationFocus(shape.id)) {
      frame = requestAnimationFrame(() => focusField(5));
    }
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
    };
  }, [inputMode, shape.id]);

  useEffect(
    () => () => {
      if (longRenderTimer.current !== null) {
        window.clearTimeout(longRenderTimer.current);
      }
    },
    [],
  );

  // Track the keyboard's real visibility (it can also be dismissed from its own
  // close button) and make sure it never outlives the panel.
  useEffect(() => {
    const keyboard = window.mathVirtualKeyboard;
    const sync = () => setKeyboardOpen(keyboard.visible);
    sync();
    // The interface is an EventTarget at runtime; its typings omit that.
    const target = keyboard as unknown as EventTarget;
    target.addEventListener('virtual-keyboard-toggle', sync);
    return () => {
      target.removeEventListener('virtual-keyboard-toggle', sync);
      keyboard.hide({ animate: false });
    };
  }, []);

  useEffect(() => {
    if (inputMode === 'visual') return;
    window.mathVirtualKeyboard.hide({ animate: true });
    setKeyboardOpen(false);
  }, [inputMode]);

  const settledLatex = useDebouncedValue(shape.props.latex, 500);
  const settledKey = settledLatex.trim();
  const settledRender = settledKey
    ? getEquationRender(settledKey)
    : undefined;
  const renderError =
    settledLatex === shape.props.latex ? settledRender?.error : undefined;
  const rawError = loadError ?? renderError ?? null;
  const error = rawError ? readableError(rawError) : null;
  const errorId = `equation-error-${shape.id}`;
  const visualHelpId = `equation-visual-help-${shape.id}`;
  const sourceHelpId = `equation-source-help-${shape.id}`;
  const currentKey = shape.props.latex.trim();
  const currentRender = currentKey ? getEquationRender(currentKey) : undefined;
  const isLongEquation =
    currentKey.length >= LONG_EQUATION_SOURCE_LENGTH ||
    shape.props.w >= LONG_EQUATION_WARNING_WIDTH;

  const updateLatex = (latex: string) => {
    const version = ++inputVersion.current;
    const key = latex.trim();
    if (longRenderTimer.current !== null) {
      window.clearTimeout(longRenderTimer.current);
      longRenderTimer.current = null;
    }
    if (!key) {
      editor.updateShape(shape.id, {
        ...centeredMove(shape, EQUATION_DEFAULT_SIZE.w, EQUATION_DEFAULT_SIZE.h),
        props: {
          latex,
          w: EQUATION_DEFAULT_SIZE.w,
          h: EQUATION_DEFAULT_SIZE.h,
        },
      });
      return;
    }

    // Very long expressions can take longer than a frame to convert. Preserve
    // the source immediately, but wait briefly for a pause before replacing the
    // measured geometry. Ordinary equations keep the instant path below.
    if (key.length >= LONG_EQUATION_SOURCE_LENGTH) {
      editor.updateShape(shape.id, { props: { latex } });
      longRenderTimer.current = window.setTimeout(() => {
        longRenderTimer.current = null;
        void typesetEquation(key).then((render) => {
          if (version !== inputVersion.current) return;
          const current = editor.getShape(shape.id);
          if (current?.type !== 'equation' || current.props.latex.trim() !== key) {
            return;
          }
          patchEquationFromRender(shape.id, latex, render);
        });
      }, LONG_EQUATION_RENDER_DELAY_MS);
      return;
    }

    // Once MathJax is warm this fills the cache synchronously, letting one
    // document patch carry source and measured geometry per keystroke. Before
    // then the field still accepts input and the shape catches up on load.
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

  const toggleKeyboard = () => {
    const keyboard = window.mathVirtualKeyboard;
    const next = !keyboard.visible;
    if (next) {
      fieldRef.current?.focus();
      keyboard.show({ animate: true });
    } else {
      keyboard.hide({ animate: true });
    }
    setKeyboardOpen(next);
  };

  // Escape hands the keyboard back to the canvas, where Delete, nudge and tool
  // hotkeys work again.
  const releaseFocus = () => {
    fieldRef.current?.blur();
    sourceRef.current?.blur();
    window.mathVirtualKeyboard.hide({ animate: true });
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>('[data-canvas-surface]')
        ?.focus({ preventScroll: true });
    });
  };

  const zoomToEquation = () => {
    requestCanvasZoomToBounds(shapeRotatedBounds(shape));
  };

  return (
    <Surface
      role="region"
      aria-label="Equation controls"
      className="equation-panel touch-targets flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto p-4 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-content-emphasis">
            Equation
          </div>
          <div className="text-xs text-content-subtle">
            {loadError
              ? 'Renderer unavailable'
              : ready
                ? 'Standalone display math'
                : 'Preparing renderer…'}
          </div>
        </div>
        {inputMode === 'visual' ? (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Math keyboard"
            aria-pressed={keyboardOpen}
            title="Math keyboard"
            onClick={toggleKeyboard}
            className={cn('shrink-0', keyboardOpen && 'bg-bg-muted')}
          >
            <Keyboard aria-hidden="true" />
          </Button>
        ) : null}
      </div>

      <Tabs
        value={inputMode}
        onValueChange={(value) => setInputMode(value as EquationInputMode)}
        className="gap-2"
      >
        <TabsList aria-label="Equation input mode" className="w-full">
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="source">LaTeX source</TabsTrigger>
        </TabsList>

        <TabsContent value="visual">
          <FieldGroup className="gap-2">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel
                htmlFor={`equation-visual-${shape.id}`}
                className={SECTION_LABEL}
              >
                Formula
              </FieldLabel>
              <div
                data-overflow={isLongEquation ? true : undefined}
                className={cn(
                  'equation-field-shell rounded-md border border-border-subtle bg-bg-muted px-0.5 py-1.5 transition-[background-color,border-color,box-shadow] duration-150',
                  'focus-within:border-border-emphasis focus-within:ring-2 focus-within:ring-border-emphasis',
                  'group-data-[invalid]/field:border-content-error group-data-[invalid]/field:ring-2 group-data-[invalid]/field:ring-content-error/20',
                )}
              >
                <MathField
                  id={`equation-visual-${shape.id}`}
                  // Matches the visible label: a mismatch breaks voice control.
                  aria-label="Formula"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={
                    error ? `${visualHelpId} ${errorId}` : visualHelpId
                  }
                  className="w-full"
                  value={shape.props.latex}
                  format="latex"
                  virtualKeyboardPolicy="manual"
                  // MathLive typesets the placeholder, so plain words arrive as
                  // spaceless italic math ("Typeanequation"). \text keeps the
                  // spacing and an upright, non-formula look.
                  placeholder={String.raw`\text{Type an equation…}`}
                  elementRef={(element) => {
                    fieldRef.current = element;
                  }}
                  onChange={updateLatex}
                  onEscape={releaseFocus}
                />
              </div>
              <FieldDescription
                id={visualHelpId}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
              >
                <span>
                  <Kbd>\</Kbd> searches commands
                </span>
                <span aria-hidden="true">·</span>
                <span>
                  <Kbd>Esc</Kbd> returns to the canvas
                </span>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </TabsContent>

        <TabsContent value="source" className="flex flex-col gap-3">
          <FieldGroup className="gap-2">
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel
                htmlFor={`equation-source-${shape.id}`}
                className={SECTION_LABEL}
              >
                LaTeX source
              </FieldLabel>
              <Textarea
                ref={sourceRef}
                id={`equation-source-${shape.id}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={
                  error ? `${sourceHelpId} ${errorId}` : sourceHelpId
                }
                value={shape.props.latex}
                onChange={(event) => updateLatex(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  releaseFocus();
                }}
                placeholder="\\frac{a}{b}"
                spellCheck={false}
                className="min-h-24 resize-y font-mono text-sm"
              />
              <FieldDescription id={sourceHelpId} className="text-xs">
                Edit raw LaTeX. The preview below uses the same renderer as the
                canvas.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <div className="flex flex-col gap-1.5">
            <PanelLabel>Canvas preview</PanelLabel>
            <div
              role="img"
              aria-label={
                currentKey
                  ? `Preview of equation: ${currentKey}`
                  : 'Empty equation preview'
              }
              className="flex min-h-16 items-center overflow-x-auto rounded-md border border-border-subtle bg-bg-muted p-3"
            >
              {!currentKey ? (
                <span className="text-xs text-content-subtle">
                  Start typing to preview the equation.
                </span>
              ) : currentRender && !('error' in currentRender) ? (
                <div
                  aria-hidden="true"
                  className="equation-output-preview"
                  style={{ color: shape.props.color }}
                  dangerouslySetInnerHTML={{ __html: currentRender.svg }}
                />
              ) : error ? (
                <span className="text-xs text-content-error">
                  Preview unavailable until the equation is fixed.
                </span>
              ) : (
                <span className="text-xs text-content-subtle">Rendering…</span>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {error ? (
        <FieldError id={errorId}>
          <div className="flex flex-col gap-0.5">
            <span>{error}</span>
            <span>This equation won’t be included in exports until fixed.</span>
          </div>
        </FieldError>
      ) : null}

      {isLongEquation && !error ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-content-subtle">
            Long equations stay on one line. Use a structure template for
            explicit breaks.
          </p>
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={zoomToEquation}
          >
            <Maximize2 data-icon="inline-start" aria-hidden="true" />
            Zoom to equation
          </Button>
        </div>
      ) : null}

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

  // An equation left empty is editing scaffolding, not content: drop it when
  // the selection moves on, rather than stranding a placeholder box on the
  // board (and in exports).
  const lastEditedId = useRef<string | null>(null);
  useEffect(() => {
    if (playbackActive) return;
    const previous = lastEditedId.current;
    lastEditedId.current = equationShape?.id ?? null;
    if (!previous || previous === equationShape?.id) return;
    const stale = editor.getShape(previous);
    if (stale?.type === 'equation' && !stale.props.latex.trim()) {
      editor.deleteShapes([previous]);
    }
  }, [equationShape?.id, playbackActive]);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && equationShape ? (
        <EquationPanelContent shape={equationShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
