import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import {
  genId,
  type EquationProps,
  type EquationShape,
  type Shape,
} from '@whiteboard/shared';
import {
  applyLatexCompletion,
  latexTokenAt,
  matchLatexCompletions,
  type LatexCompletion,
} from '@/canvas/equation-complete';
import {
  hasEquationFocusRequest,
  requestEquationFocus,
  resolveEquationFocus,
  subscribeEquationFocus,
} from '@/canvas/equation-focus';
import {
  ensureEquationRenderer,
  getEquationRender,
  typesetEquation,
  useEquationRender,
  type EquationRender,
} from '@/canvas/equation-render';
import {
  editReplacement,
  environmentNewline,
  openBracket,
  skipClosingBracket,
  tabEdit,
  type SourceEdit,
} from '@/canvas/equation-shortcuts';
import {
  locateLatexError,
  normalizePastedLatex,
  readableError,
  sourceExcerpt,
  sourceProblem,
  type SourceSpan,
} from '@/canvas/equation-source';
import { getTopIndex } from '@/canvas/order';
import {
  centeredMove,
  EQUATION_DEFAULT_SIZE,
  EQUATION_SETTLE_MS,
} from '@/canvas/shapes/equation';
import { editor } from '@/canvas/use-document-store';
import { useShape } from '@/canvas/use-shapes';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Textarea } from '@/components/ui/textarea';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { EquationAiPrompt, useEquationDictation } from './equation-dictation';
import { EquationPreview, type TypesetRender } from './equation-preview';
import { FIELD_SURFACE } from './equation-panel-styles';
import { EquationStyleControls } from './equation-style-controls';

// Frames the panel keeps re-asserting focus for (~200ms at 60fps): long enough
// to outlast a lazily mounted panel, short enough that it never fights a user
// who clicked elsewhere.
const FOCUS_ATTEMPTS = 12;

/**
 * Space between one line of a derivation and the next, as a fraction of the
 * font size — so the lines of a 40pt derivation are spaced like a 40pt one
 * rather than like a 16pt one that happens to be bigger.
 */
const LINE_GAP_EM = 0.5;

/** Completions the list shows at once, before the caret has to do the work. */
const SUGGESTION_LIMIT = 7;

/**
 * How long the source holds still before a structural fault is worth pointing
 * at. Reading the source is instant, but a `{` is unbalanced for as long as it
 * takes to type its contents — and a `\begin` has no `\end` until it does — so
 * reacting to every keystroke would flash a warning through most of normal
 * typing. Well under `EQUATION_SETTLE_MS`: the whole point is to name the
 * problem before MathJax gets a chance to.
 */
const PROBLEM_HINT_MS = 180;

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/**
 * Commit whichever props produced `render`, together with the size it measures.
 *
 * The two travel as one update because the box is a cache of the render: a
 * source or a style committed on its own would leave every collaborator's
 * canvas drawing the new content inside the old box until a second update
 * arrived, and would leave it there for good if that update never did.
 */
function patchEquationFromRender(
  shapeId: string,
  props: { latex?: string; inline?: boolean },
  render: EquationRender,
): void {
  const current = editor.getShape(shapeId);
  if (!current || current.type !== 'equation') return;
  if ('error' in render) {
    editor.updateShape(shapeId, { props });
    return;
  }
  const scale = current.props.fontSize / 16;
  const w = render.width * scale;
  const h = render.height * scale;
  editor.updateShape(shapeId, {
    ...centeredMove(current, w, h),
    props: { ...props, w, h },
  });
}

/**
 * Write `value` into the field the way a keypress would, so the browser's own
 * undo history keeps the change.
 *
 * The field is controlled by the shape, so committing a rewrite through state
 * makes React assign `textarea.value` — and an assignment wipes the field's
 * undo stack. Ctrl+Z inside a text field belongs to the browser (the canvas
 * handler ignores typing targets, see `isTypingTarget` in Canvas.tsx), so that
 * stack is the only undo the source field has: without this, expanding `fr`
 * into `\frac{}{}` and pressing Ctrl+Z lost the whole equation rather than the
 * expansion.
 *
 * `execCommand` is deprecated and has no replacement that records undo — where
 * it is missing or declines the edit (jsdom, a hidden field), this reports
 * failure and the caller falls back to a plain state write.
 */
function writeThroughUndoStack(
  field: HTMLTextAreaElement,
  value: string,
): boolean {
  const replacement = editReplacement(field.value, value);
  // A rule that only moved the caret has nothing to write.
  if (!replacement) return true;
  try {
    field.setSelectionRange(replacement.start, replacement.end);
    // `insertText` with an empty string is not a delete in every engine.
    const wrote = replacement.text
      ? document.execCommand('insertText', false, replacement.text)
      : document.execCommand('delete');
    if (!wrote) return false;
  } catch {
    return false;
  }
  return field.value === value;
}

export function EquationPanelContent({ shape }: { shape: EquationShape }) {
  const shapeId = shape.id;
  const inline = shape.props.inline ?? false;
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const inputVersion = useRef(0);
  const focusFrame = useRef(0);
  const pendingWrap = useRef<{ index: number; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<LatexCompletion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);

  /** Focus the source field, retrying until it reports that the focus took. */
  const focusInput = useCallback(
    (select?: SourceSpan) => {
      function attempt(tries: number): void {
        const target = sourceRef.current;
        if (!target) return retry(tries);
        target.focus();
        if (document.activeElement !== target) return retry(tries);
        const end = target.value.length;
        const from = select ? Math.min(select.index, end) : end;
        const to = select ? Math.min(select.index + select.length, end) : end;
        target.setSelectionRange(from, to);
        settle();
      }
      function retry(tries: number): void {
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

  useEffect(() => {
    const handleFocusRequest = (id: string) => {
      if (id !== shapeId) return;
      focusInput();
    };
    const unsubscribe = subscribeEquationFocus(handleFocusRequest);
    if (hasEquationFocusRequest(shapeId)) focusInput();
    return unsubscribe;
  }, [focusInput, shapeId]);

  useEffect(() => () => cancelAnimationFrame(focusFrame.current), []);

  const settledLatex = useDebouncedValue(shape.props.latex, EQUATION_SETTLE_MS);
  const settledKey = settledLatex.trim();
  // Two subscriptions, each to one expression: the panel re-renders for the
  // equation being edited, and every other equation on the board sits still.
  const settledRender = useEquationRender(settledKey, inline);
  const sourceSettled = settledLatex === shape.props.latex;
  const renderError = sourceSettled ? settledRender?.error : undefined;
  const rawError = loadError ?? renderError ?? null;
  const error = rawError ? readableError(rawError) : null;
  const errorSpan = renderError
    ? locateLatexError(shape.props.latex, renderError)
    : null;
  const errorExcerpt = errorSpan
    ? sourceExcerpt(shape.props.latex, errorSpan)
    : null;
  const errorId = `equation-error-${shape.id}`;
  const listId = `equation-completions-${shape.id}`;
  const sourceId = `equation-source-${shape.id}`;
  const currentKey = shape.props.latex.trim();
  const currentRender = useEquationRender(currentKey, inline);

  const lastGoodRender = useRef<TypesetRender | null>(null);
  const freshRender =
    currentRender && !('error' in currentRender) ? currentRender : null;
  if (freshRender) lastGoodRender.current = freshRender;
  if (!currentKey) lastGoodRender.current = null;
  const previewRender = freshRender ?? lastGoodRender.current;
  const previewStale = !freshRender && previewRender !== null && sourceSettled;

  // A brace, delimiter or environment that never closes, found by reading the
  // source rather than by waiting for a typeset to fail — and only once the
  // source has paused, so the `{` a user is still typing into doesn't accuse
  // them. Held against the paused text, so the one-click repair can never be
  // applied to a source that has moved on.
  const pausedLatex = useDebouncedValue(shape.props.latex, PROBLEM_HINT_MS);
  const problem =
    pausedLatex === shape.props.latex ? sourceProblem(pausedLatex) : null;
  const problemExcerpt = problem
    ? sourceExcerpt(shape.props.latex, problem.span)
    : null;
  const problemId = `equation-problem-${shape.id}`;
  // Whichever of the two message blocks is on screen also describes the field.
  const messageId = error ? errorId : problem ? problemId : undefined;

  const updateLatex = (latex: string) => {
    const version = ++inputVersion.current;
    const key = latex.trim();
    if (!key) {
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

    const cached = getEquationRender(key, inline);
    if (cached) {
      patchEquationFromRender(shape.id, { latex }, cached);
      return;
    }

    editor.updateShape(shape.id, { props: { latex } });
    void typesetEquation(key, inline)
      .then((render) => {
        if (version !== inputVersion.current) return;
        patchEquationFromRender(shape.id, { latex }, render);
      })
      .catch(() => undefined);
  };

  const dictation = useEquationDictation({ updateLatex, focusInput });

  /**
   * Switch between display and text style, re-measuring the box as it goes:
   * the same source is a different shape in each — `\sum` grows limits above
   * itself in display style and puts them beside itself in text style.
   *
   * Bumping the input version cancels any conversion still in flight for the
   * style being left, whose measurements would otherwise land on the shape
   * after this one and resize it back.
   */
  const applyInline = (next: boolean) => {
    if (next === inline) return;
    const version = ++inputVersion.current;
    const key = shape.props.latex.trim();
    if (!key) {
      editor.updateShape(shape.id, { props: { inline: next } });
      return;
    }
    const cached = getEquationRender(key, next);
    if (cached) {
      patchEquationFromRender(shape.id, { inline: next }, cached);
      return;
    }
    // Nothing to measure yet, so the style goes ahead on its own: the
    // control reads its state back off the shape, and waiting for a cold
    // renderer would leave the button not responding to the click. The size
    // follows when the render lands.
    editor.updateShape(shape.id, { props: { inline: next } });
    void typesetEquation(key, next)
      .then((render) => {
        if (version !== inputVersion.current) return;
        patchEquationFromRender(shape.id, { inline: next }, render);
      })
      .catch(() => undefined);
  };

  /**
   * Start the next line of a derivation: a second equation below this one,
   * inheriting its style, and focused ready to type.
   *
   * Placed by its *center* rather than its left edge, because the center is
   * what an equation is resized around as it is typed (see `centeredMove`) —
   * lines aligned on their left edges would drift apart with every keystroke,
   * while centered ones stay a stack.
   */
  const addEquationBelow = () => {
    const current = editor.getShape(shape.id);
    if (current?.type !== 'equation' || !current.props.latex.trim()) return;
    const props: EquationProps = {
      ...current.props,
      latex: '',
      w: EQUATION_DEFAULT_SIZE.w,
      h: EQUATION_DEFAULT_SIZE.h,
    };
    // Down the rotated shape's own axis, so a tilted derivation stays a line
    // rather than stepping sideways out from under itself.
    const centerToCenter =
      current.props.h / 2 + props.fontSize * LINE_GAP_EM + props.h / 2;
    const centerX =
      current.x +
      current.props.w / 2 -
      Math.sin(current.rotation) * centerToCenter;
    const centerY =
      current.y +
      current.props.h / 2 +
      Math.cos(current.rotation) * centerToCenter;
    const id = genId();
    editor.createShape({
      id,
      type: 'equation',
      x: centerX - props.w / 2,
      y: centerY - props.h / 2,
      rotation: current.rotation,
      index: getTopIndex(editor.getShapes()),
      props,
    } as Shape);
    useSelectionStore.getState().setSelection([id]);
    requestEquationFocus(id);
  };

  const closeSuggestions = () => {
    setSuggestions([]);
    setActiveSuggestion(0);
    pendingWrap.current = null;
  };

  /** Offer completions for the `\command` the caret is sitting in, if any. */
  const refreshSuggestions = (target: HTMLTextAreaElement) => {
    const token = latexTokenAt(target.value, target.selectionStart ?? 0);
    // The caret has left the command the selection was going to fill, so there
    // is no longer a completion for it to arrive with.
    if (!token) pendingWrap.current = null;
    setSuggestions(
      token ? matchLatexCompletions(token.text, SUGGESTION_LIMIT) : [],
    );
    setActiveSuggestion(0);
  };

  /**
   * Commit a shortcut's rewrite of the whole source.
   *
   * The write goes through the browser's insertion path where it can, so the
   * field's undo history survives (`writeThroughUndoStack`); that also fires
   * the field's own `change`, which is what carries the new source into the
   * shape. Only the fallback has to call `updateLatex` by hand.
   *
   * The caret is restored either way: the field is controlled by the shape, so
   * a re-render puts the value back with no opinion about where the caret was.
   */
  const applyEdit = (edit: SourceEdit) => {
    const field = sourceRef.current;
    if (!field || !writeThroughUndoStack(field, edit.value)) {
      updateLatex(edit.value);
    }
    field?.setSelectionRange(edit.caret, edit.caret);
    closeSuggestions();
    requestAnimationFrame(() => {
      sourceRef.current?.setSelectionRange(edit.caret, edit.caret);
    });
  };

  const acceptSuggestion = (completion: LatexCompletion) => {
    const target = sourceRef.current;
    if (!target) return;
    const token = latexTokenAt(target.value, target.selectionStart ?? 0);
    if (!token) return closeSuggestions();
    // Only the command typed *over* the selection inherits it: if the caret
    // moved and another one was started elsewhere, the text belongs to neither.
    const wrap = pendingWrap.current;
    applyEdit(
      applyLatexCompletion(
        target.value,
        token,
        completion,
        wrap?.index === token.index ? wrap.text : '',
      ),
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return;
    const target = event.currentTarget;
    const value = target.value;
    const start = target.selectionStart ?? value.length;
    const end = target.selectionEnd ?? start;
    const take = (edit: SourceEdit | null): boolean => {
      if (!edit) return false;
      event.preventDefault();
      applyEdit(edit);
      return true;
    };

    // A `\` typed over a selection begins "wrap this in a command": the browser
    // deletes the selection to make room for the backslash, and the completion
    // accepted next puts the text back inside the snippet's first slot. Nothing
    // is intercepted here, so a backslash that no completion follows leaves the
    // field behaving exactly as a textarea does — typed over, and restorable
    // with the undo the field already keeps.
    if (event.key === '\\' && start !== end) {
      pendingWrap.current = { index: start, text: value.slice(start, end) };
    }

    // The next line of a derivation, from anywhere in the field — including
    // with the completion list open, where a bare Enter belongs to the list.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      addEquationBelow();
      return;
    }

    if (suggestions.length) {
      const move =
        event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
      if (move) {
        event.preventDefault();
        setActiveSuggestion(
          (index) => (index + move + suggestions.length) % suggestions.length,
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        const completion = suggestions[activeSuggestion];
        if (completion) {
          event.preventDefault();
          acceptSuggestion(completion);
          return;
        }
      }
      if (event.key === 'Escape') {
        // Dismiss the list first; a second Escape leaves for the canvas.
        event.preventDefault();
        event.stopPropagation();
        closeSuggestions();
        return;
      }
    }

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        releaseFocus();
        return;
      case 'Enter':
        if (event.shiftKey) return;
        take(environmentNewline(value, start));
        return;
      case 'Tab':
        if (event.shiftKey) return;
        take(tabEdit(value, start));
        return;
      case '(':
      case '[':
      case '{':
        take(openBracket(value, start, end, event.key));
        return;
      case ')':
      case ']':
      case '}':
        take(skipClosingBracket(value, start, end, event.key));
        return;
      default:
    }
  };

  const releaseFocus = () => {
    sourceRef.current?.blur();
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

  // One panel, one material. Firefox's Proton panels name themselves in a
  // header, rule their groups off with full-bleed hairlines, and put the
  // auxiliary action in a dimmed footer — they never nest a card inside a
  // card, which is what the old tray-of-cards construction was doing. The
  // order is the object first: the rendered equation is pinned under the
  // header so it never scrolls out from under the field that changes it.
  return (
    <TooltipProvider delay={300}>
      <Surface
        role="region"
        aria-label="Equation"
        onKeyDownCapture={dictation.onKeyDownCapture}
        className="touch-targets flex max-h-[calc(100dvh-7rem-env(safe-area-inset-top))] w-[min(23rem,calc(100vw-2rem))] flex-col overflow-hidden border-0 bg-[var(--ds-surface-overlay)] p-0 [--chrome-hover:var(--color-tb-track)] sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
      >
        <EquationPreview
          shape={shape}
          currentKey={currentKey}
          render={previewRender}
          stale={previewStale}
          ready={ready}
          loadError={loadError}
          onAddBelow={addEquationBelow}
        />

        {/* Source, and anything wrong with it. The only part that scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <div className="px-4 py-3">
            <label htmlFor={sourceId} className="sr-only">
              LaTeX
            </label>
            <div className="relative">
              <Textarea
                ref={sourceRef}
                id={sourceId}
                aria-invalid={error ? true : undefined}
                aria-describedby={messageId}
                aria-autocomplete="list"
                aria-expanded={suggestions.length > 0}
                aria-controls={suggestions.length ? listId : undefined}
                aria-activedescendant={
                  suggestions.length
                    ? `${listId}-${activeSuggestion}`
                    : undefined
                }
                value={shape.props.latex}
                onChange={(event) => {
                  updateLatex(event.target.value);
                  refreshSuggestions(event.target);
                }}
                onKeyDown={handleKeyDown}
                onBlur={closeSuggestions}
                onPaste={(event) => {
                  const pasted = event.clipboardData.getData('text/plain');
                  const unwrapped = normalizePastedLatex(pasted);
                  if (unwrapped === pasted) return;
                  const target = event.currentTarget;
                  const start = target.selectionStart ?? target.value.length;
                  const end = target.selectionEnd ?? start;
                  event.preventDefault();
                  applyEdit({
                    value:
                      target.value.slice(0, start) +
                      unwrapped +
                      target.value.slice(end),
                    caret: start + unwrapped.length,
                  });
                }}
                placeholder={String.raw`\frac{a}{b}`}
                spellCheck={false}
                rows={3}
                className={cn(FIELD_SURFACE, 'min-h-20 w-full resize-none rounded-compact px-2 py-2 font-mono text-sm leading-5 text-fg')}
              />

              {/* The urlbar's own autocomplete: a popup on the popup surface,
                  4px padding, and the active row washed with `currentColor`
                  rather than tinted with the accent — the accent on this panel
                  means "this setting is on", not "the caret is here". */}
              {suggestions.length ? (
                <ul
                  id={listId}
                  role="listbox"
                  aria-label="LaTeX commands"
                  className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-overlay border border-border bg-popup-surface p-1 shadow-overlay"
                >
                  {suggestions.map((completion, index) => (
                    <li
                      key={completion.command}
                      id={`${listId}-${index}`}
                      role="option"
                      aria-selected={index === activeSuggestion}
                      // Keep the caret in the field: a blur would close the list
                      // before the click that chose from it landed.
                      onPointerDown={(event) => event.preventDefault()}
                      onPointerEnter={() => setActiveSuggestion(index)}
                      onClick={() => acceptSuggestion(completion)}
                      className={cn(
                        'flex cursor-pointer items-baseline justify-between gap-3 rounded-control px-2 py-1.5',
                        index === activeSuggestion && 'bg-tb-track',
                      )}
                    >
                      <code className="truncate font-mono text-xs text-fg">
                        {completion.command}
                      </code>
                      <span className="shrink-0 text-2xs text-fg-muted">
                        {completion.hint}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          {/* Firefox states a problem with a full-bleed notification bar, not
              with a bordered box floating in the padding: the strip spans the
              panel, the icon sizes to the text, and the repair is a text
              button on the same line rather than a second block. */}
          {error ? (
            <div
              id={errorId}
              role="alert"
              className="mx-4 mb-3 flex shrink-0 items-start gap-3 rounded-panel bg-[var(--ds-background-danger)] p-3 text-sm text-fg"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0 text-[var(--ds-icon-danger)]"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="min-w-0">{error}</span>
                {errorExcerpt ? (
                  <button
                    type="button"
                    onClick={() => errorSpan && focusInput(errorSpan)}
                    className="min-w-0 truncate rounded-control border border-border bg-surface px-1.5 py-1 text-left font-mono text-2xs"
                  >
                    {errorExcerpt.clippedStart ? '…' : null}
                    {errorExcerpt.before}
                    <span className="rounded-xs bg-danger/15 px-0.5 font-semibold underline decoration-wavy underline-offset-2">
                      {errorExcerpt.marked}
                    </span>
                    {errorExcerpt.after}
                    {errorExcerpt.clippedEnd ? '…' : null}
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {/* A fault in the source, named while it is still being written.
              Suppressed once MathJax has failed: the bar above is then saying
              the same thing with the renderer's own words. */}
          {!error && problem && problemExcerpt ? (
            <div
              id={problemId}
              role="status"
              className="mx-4 mb-3 flex shrink-0 items-start gap-3 rounded-panel bg-[var(--ds-background-warning)] p-3 text-sm text-fg"
            >
              <AlertCircle
                className="mt-0.5 size-4 shrink-0 text-[var(--ds-icon-warning)]"
                aria-hidden="true"
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="min-w-0">{problem.message}</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => focusInput(problem.span)}
                    className="min-w-0 flex-1 truncate rounded-control border border-border bg-surface px-1.5 py-1 text-left font-mono text-2xs"
                  >
                    {problemExcerpt.clippedStart ? '…' : null}
                    {problemExcerpt.before}
                    <span className="rounded-xs bg-warning/15 px-0.5 font-semibold underline decoration-wavy underline-offset-2">
                      {problemExcerpt.marked}
                    </span>
                    {problemExcerpt.after}
                    {problemExcerpt.clippedEnd ? '…' : null}
                  </button>
                  <Button
                    variant="ghost"
                    size="xs"
                    // Keep the caret in the field: the repair is written through
                    // the field's own insertion path, which needs it focused to
                    // land on the undo stack.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => applyEdit(problem.fix)}
                    className="shrink-0 text-fg"
                  >
                    {problem.action}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <EquationAiPrompt
          dictation={dictation}
          spaced={Boolean(error || (problem && problemExcerpt))}
        />

        <EquationStyleControls shape={shape} onInlineChange={applyInline} />
      </Surface>
    </TooltipProvider>
  );
}

export function EquationPanel() {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Subscribe to the one selected shape, not the whole page record — see the
  // same note in graph-panel.tsx.
  const selectedShape = useShape(selectedId);
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
