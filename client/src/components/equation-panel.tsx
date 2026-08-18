import { useCallback, useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { Check, Copy, Keyboard, Maximize2 } from 'lucide-react';
import type { EquationShape } from '@whiteboard/shared';
import { requestCanvasZoomToBounds } from '@/canvas/camera-requests';
import {
  hasEquationFocusRequest,
  resolveEquationFocus,
  subscribeEquationFocus,
} from '@/canvas/equation-focus';
import {
  ensureEquationRenderer,
  getEquationRender,
  typesetEquation,
  useEquationRenderStore,
  type EquationRender,
} from '@/canvas/equation-render';
import {
  locateLatexError,
  normalizePastedLatex,
  readableError,
  sourcePosition,
  type SourceSpan,
} from '@/canvas/equation-source';
import {
  EQUATION_DEFAULT_SIZE,
  EQUATION_SETTLE_MS,
} from '@/canvas/shapes/equation';
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
const SECTION_LABEL = 'text-xs font-medium text-secondary';

type EquationInputMode = 'visual' | 'source';

// Frames the panel keeps re-asserting focus for (~200ms at 60fps): long enough
// to outlast MathLive's own ~60ms focus transition and a lazily mounted tab
// panel, short enough that it never fights a user who clicked elsewhere.
const FOCUS_ATTEMPTS = 12;

const LONG_EQUATION_SOURCE_LENGTH = 240;
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
  const shapeId = shape.id;
  const fieldRef = useRef<MathfieldElement | null>(null);
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const inputVersion = useRef(0);
  const focusFrame = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inputMode, setInputMode] = useState<EquationInputMode>('visual');
  useEquationRenderStore((state) => state.version);

  /**
   * Focus the input for `mode`, retrying until the field reports that it took.
   *
   * "The element exists" is not enough to stop retrying: a MathLive field drops
   * `focus()` on the floor while one of its own focus/blur transitions is still
   * in flight, which is exactly the window a freshly placed equation lands in —
   * the canvas surface takes DOM focus on the placing pointer-down, one frame
   * before this runs. Retrying only until the element mounts left the caret on
   * the canvas and the user typing into nothing.
   *
   * Without a `select` range the caret lands at the end of the expression, so
   * switching between visual and source picks up where the last one left off
   * rather than dropping the user at character zero.
   */
  const focusInput = useCallback(
    (mode: EquationInputMode, select?: SourceSpan) => {
      function attempt(tries: number): void {
        if (mode === 'source') {
          const target = sourceRef.current;
          if (!target) return retry(tries);
          target.focus();
          if (document.activeElement !== target) return retry(tries);
          const end = target.value.length;
          const from = select ? Math.min(select.index, end) : end;
          const to = select
            ? Math.min(select.index + select.length, end)
            : end;
          target.setSelectionRange(from, to);
          return settle();
        }
        const field = fieldRef.current;
        if (!field) return retry(tries);
        field.focus();
        // MathLive moves real DOM focus into its shadow-root delegate on a
        // ~60ms timer, and ignores `focus()` entirely while one of its own
        // focus/blur transitions is in flight. Keep asking until the browser
        // agrees the field has the keyboard — `focus()` is a no-op meanwhile.
        if (document.activeElement !== field) return retry(tries);
        field.position = field.lastOffset;
        // Only touch-primary devices, where the math keyboard is the only way
        // to type.
        if (prefersVirtualKeyboard()) {
          window.mathVirtualKeyboard.show({ animate: true });
        }
        settle();
      }
      function retry(tries: number): void {
        // Out of frames: stop claiming the request, so it can't fire at a later
        // ordinary selection of this shape instead.
        if (tries <= 0) return settle();
        focusFrame.current = requestAnimationFrame(() => attempt(tries - 1));
      }
      function settle(): void {
        resolveEquationFocus(shapeId);
      }
      cancelAnimationFrame(focusFrame.current);
      focusFrame.current = requestAnimationFrame(() => attempt(FOCUS_ATTEMPTS));
    },
    [shapeId],
  );

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadError(null);
    void ensureEquationRenderer()
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

  // Focus both freshly placed and already-selected equations on request. The
  // request outlives this effect, so a re-run (StrictMode's second mount, an
  // input-mode switch) picks up a focus that never landed and chases it again.
  useEffect(() => {
    const handleFocusRequest = (id: string) => {
      if (id !== shapeId) return;
      focusInput(inputMode);
    };
    const unsubscribe = subscribeEquationFocus(handleFocusRequest);
    if (hasEquationFocusRequest(shapeId)) focusInput(inputMode);
    return unsubscribe;
    // A pending focus frame deliberately outlives this effect: switching input
    // mode re-runs it, and cancelling here would kill the focus that the switch
    // itself just scheduled. Unmount cleanup below cancels it instead.
  }, [focusInput, inputMode, shapeId]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      cancelAnimationFrame(focusFrame.current);
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

  const settledLatex = useDebouncedValue(shape.props.latex, EQUATION_SETTLE_MS);
  const settledKey = settledLatex.trim();
  const settledRender = settledKey
    ? getEquationRender(settledKey)
    : undefined;
  const renderError =
    settledLatex === shape.props.latex ? settledRender?.error : undefined;
  const rawError = loadError ?? renderError ?? null;
  const error = rawError ? readableError(rawError) : null;
  // Only a typeset failure has a place in the source; a renderer that failed to
  // load says nothing about what the user typed.
  const errorSpan = renderError
    ? locateLatexError(shape.props.latex, renderError)
    : null;
  const errorAt = errorSpan
    ? sourcePosition(shape.props.latex, errorSpan.index)
    : null;
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
    if (!key) {
      // Re-read rather than centering off the captured prop: a collaborator can
      // have moved or resized this shape since the render that made this
      // handler, and every other path here already goes through the store.
      const current = editor.getShape(shape.id);
      if (current?.type !== 'equation') return;
      editor.updateShape(shape.id, {
        ...centeredMove(
          current,
          EQUATION_DEFAULT_SIZE.w,
          EQUATION_DEFAULT_SIZE.h,
        ),
        props: {
          latex,
          w: EQUATION_DEFAULT_SIZE.w,
          h: EQUATION_DEFAULT_SIZE.h,
        },
      });
      return;
    }

    // Anything already typeset still lands in a single document patch carrying
    // both the source and its measured geometry — which covers backspacing
    // back through an expression, since every prefix was converted on the way
    // in.
    const cached = getEquationRender(key);
    if (cached) {
      patchEquationFromRender(shape.id, latex, cached);
      return;
    }

    // Otherwise the source is saved on this keystroke and the geometry follows
    // when the worker answers. Conversion is off the main thread, so there is
    // no longer a warm path that could fill both at once — and equally no need
    // for the old length-based throttle, since a slow expression no longer
    // costs the typist a frame.
    editor.updateShape(shape.id, { props: { latex } });
    void typesetEquation(key)
      .then((render) => {
        // A later keystroke has already asked for its own geometry; letting
        // this one land would size the shape to an expression that is no
        // longer in the field.
        if (version !== inputVersion.current) return;
        patchEquationFromRender(shape.id, latex, render);
      })
      // Only the renderer being unavailable rejects here, and the mount effect
      // already reports that as `loadError`. The source is saved either way.
      .catch(() => undefined);
  };

  /** Replace the textarea's selection with `text`, leaving the caret after it. */
  const replaceSourceSelection = (
    target: HTMLTextAreaElement,
    text: string,
  ) => {
    const start = target.selectionStart ?? target.value.length;
    const end = target.selectionEnd ?? start;
    updateLatex(target.value.slice(0, start) + text + target.value.slice(end));
    const caret = start + text.length;
    // The textarea is controlled, so the new value only reaches the DOM on the
    // next commit; moving the caret before then would put it in the old text.
    requestAnimationFrame(() => target.setSelectionRange(caret, caret));
  };

  const copyLatex = async () => {
    try {
      await navigator.clipboard.writeText(shape.props.latex);
    } catch {
      // Clipboard API unavailable (e.g. an insecure context): the source tab
      // still offers the text for a manual copy.
      return;
    }
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  const showErrorInSource = () => {
    if (!errorSpan) return;
    setInputMode('source');
    focusInput('source', errorSpan);
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
    // Leaving an equation empty discards it, the same rule the panel applies
    // when the selection moves on — otherwise Escape strands a placeholder box
    // on the board with nothing in it.
    if (!shape.props.latex.trim()) {
      editor.deleteShapes([shape.id]);
      useSelectionStore.getState().clear();
    }
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
      className="equation-panel touch-targets flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(22rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto p-5 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold tracking-tight text-primary">
            Equation
          </div>
          <div className="text-xs text-secondary">
            {loadError
              ? 'Renderer unavailable'
              : ready
                ? 'Standalone display math'
                : 'Preparing renderer…'}
          </div>
        </div>
        {/* Copy sits last so it stays put against the panel edge when the
            keyboard toggle comes and goes with the input mode. */}
        <div className="flex shrink-0 items-center gap-1">
          {inputMode === 'visual' ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Math keyboard"
              aria-pressed={keyboardOpen}
              title="Math keyboard"
              onClick={toggleKeyboard}
              className={cn(keyboardOpen && 'bg-subtle')}
            >
              <Keyboard aria-hidden="true" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={copied ? 'LaTeX copied' : 'Copy LaTeX'}
            title="Copy LaTeX"
            disabled={!currentKey}
            onClick={() => void copyLatex()}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
        </div>
      </div>

      <Tabs
        value={inputMode}
        onValueChange={(value) => {
          const next = value as EquationInputMode;
          setInputMode(next);
          focusInput(next);
        }}
        className="gap-2"
      >
        {/* Activating a tab moves focus into its field, so the tabs activate on
            Enter rather than on arrow keys — otherwise arrowing between the two
            would drop the user into the editor mid-navigation. */}
        <TabsList
          aria-label="Equation input mode"
          activateOnFocus={false}
          className="w-full"
        >
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
                // The whole bordered box reads as the input, but MathLive only
                // listens on its own host — so a click in the shell's padding
                // ring would land on nothing. Forward those to the field, caret
                // at the end. Clicks on the field itself fall through, leaving
                // MathLive to put the caret where the user actually aimed.
                onPointerDown={(event) => {
                  if (event.target !== event.currentTarget) return;
                  event.preventDefault();
                  focusInput('visual');
                }}
                className={cn(
                  'equation-field-shell rounded-md border border-control-border bg-surface px-0.5 py-1.5 transition-all duration-150 ease-out',
                  'focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/20',
                  'group-data-[invalid]/field:border-danger group-data-[invalid]/field:ring-2 group-data-[invalid]/field:ring-danger/20',
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
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text/plain');
                  const unwrapped = normalizePastedLatex(pasted);
                  // Nothing to strip: let the browser paste it, so the native
                  // undo entry the default action creates is preserved.
                  if (unwrapped === pasted) return;
                  event.preventDefault();
                  replaceSourceSelection(event.currentTarget, unwrapped);
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.preventDefault();
                  releaseFocus();
                }}
                // A JSX attribute string is taken literally, so an escaped
                // backslash here would show the user a command they can't type.
                placeholder={String.raw`\frac{a}{b}`}
                spellCheck={false}
                className="min-h-24 resize-y font-mono text-sm"
              />
              <FieldDescription
                id={sourceHelpId}
                className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
              >
                <span>Edit raw LaTeX</span>
                <span aria-hidden="true">·</span>
                <span>
                  <Kbd>Esc</Kbd> returns to the canvas
                </span>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </TabsContent>
      </Tabs>

      {/* Outside the tabs: the canvas rendering is what both modes are aiming
          at, and in visual mode it is the only view of the equation when the
          shape itself is off-screen or sitting behind this panel. */}
      <div className="flex flex-col gap-1.5">
        <PanelLabel>Canvas preview</PanelLabel>
        <div
          role="img"
          aria-label={
            currentKey
              ? `Preview of equation: ${currentKey}`
              : 'Empty equation preview'
          }
          className="flex min-h-16 items-center overflow-x-auto rounded-md border border-border bg-muted p-3"
        >
          {!ready && !loadError ? (
            // Says what the header's "Preparing renderer…" means where the
            // typing is happening: the field works, only the picture is late.
            <span className="text-xs text-secondary">
              Preparing the renderer — what you type is saved.
            </span>
          ) : !currentKey ? (
            <span className="text-xs text-secondary">
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
            <span className="text-xs text-danger">
              Preview unavailable until the equation is fixed.
            </span>
          ) : (
            <span className="text-xs text-secondary">Rendering…</span>
          )}
        </div>
      </div>

      {error ? (
        <FieldError id={errorId}>
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-col gap-0.5">
              <span>{error}</span>
              <span>
                This equation won’t be included in exports until fixed.
              </span>
            </div>
            {errorAt ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  Line {errorAt.line}, column {errorAt.column}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={showErrorInSource}
                >
                  {inputMode === 'source' ? 'Highlight' : 'Show in source'}
                </Button>
              </div>
            ) : null}
          </div>
        </FieldError>
      ) : null}

      {isLongEquation && !error ? (
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-xs text-secondary">
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
      ? state.shapesById.get(selectedId)
      : undefined,
  );
  const equationShape =
    selectedShape?.type === 'equation' ? selectedShape : undefined;
  const panelVisible = Boolean(equationShape);

  // An equation left empty is editing scaffolding, not content: drop it when
  // the selection moves on, rather than stranding a placeholder box on the
  // board (and in exports).
  const lastEditedId = useRef<string | null>(null);
  useEffect(() => {
    const previous = lastEditedId.current;
    lastEditedId.current = equationShape?.id ?? null;
    if (!previous || previous === equationShape?.id) return;
    const stale = editor.getShape(previous);
    if (stale?.type === 'equation' && !stale.props.latex.trim()) {
      editor.deleteShapes([previous]);
    }
  }, [equationShape?.id]);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && equationShape ? (
        <EquationPanelContent shape={equationShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
