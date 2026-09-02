import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  CornerDownLeft,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  genId,
  type EquationProps,
  type EquationShape,
  type Shape,
} from '@whiteboard/shared';
import { aiLatexEnabled, latexFromPrompt } from '@/board/latex-ai';
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
  wrapMathLatex,
  type SourceSpan,
} from '@/canvas/equation-source';
import { getTopIndex } from '@/canvas/order';
import {
  EQUATION_DEFAULT_SIZE,
  EQUATION_SETTLE_MS,
} from '@/canvas/shapes/equation';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { paletteColors } from '@/canvas/use-style-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';

type TypesetRender = Extract<EquationRender, { svg: string }>;

// Frames the panel keeps re-asserting focus for (~200ms at 60fps): long enough
// to outlast a lazily mounted panel, short enough that it never fights a user
// who clicked elsewhere.
const FOCUS_ATTEMPTS = 12;

/** The sizes on offer, in the shape's own `fontSize` units. */
const FONT_SIZES = [16, 22, 28, 40];

/**
 * The two ways TeX sets the same expression, named for what they are used for
 * rather than for the internal style they select.
 */
const STYLES = [
  {
    inline: false,
    label: 'Display',
    hint: 'Set as its own line: limits above ∑, full-size fractions',
  },
  {
    inline: true,
    label: 'Inline',
    hint: 'Set to sit in a line of text: limits beside ∑, smaller fractions',
  },
] as const;

/**
 * A row of mutually exclusive choices — size, style — as a recess with the
 * chosen segment filled back in to white. The same track and the same flat
 * chip the toolbar marks a selected key with, so "this one is chosen" looks
 * the same wherever the board says it. Radii are concentric: 12px track less
 * its own 2px padding leaves 10px on the segment.
 */
const SEGMENTED_TRACK = 'w-full rounded-xl bg-tb-track p-0.5';

const SEGMENTED_ITEM =
  'h-8 grow basis-0 rounded-[10px] px-2.5 text-xs font-medium text-fg-muted ' +
  'hover:bg-tb-accent/60 hover:text-fg ' +
  'data-[state=on]:bg-tb-accent data-[state=on]:text-tb-accent-fg ' +
  'aria-pressed:bg-tb-accent aria-pressed:text-tb-accent-fg';

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
 * Whether the element `resolve` finds is scrolling content its box can't show,
 * re-measured when `key` changes and whenever the box is resized.
 *
 * Measured rather than guessed: a content heuristic ("this many characters")
 * misses `\int_{-\infty}^{\infty} e^{-x^2}\,dx`, which runs past the preview
 * in about thirty, and fires on long expressions that happen to fit.
 */
function useOverflowing(resolve: () => Element | null, key: unknown): boolean {
  const [overflowing, setOverflowing] = useState(false);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    const element = resolveRef.current();
    if (!element) {
      setOverflowing(false);
      return;
    }
    const measure = () => {
      setOverflowing(element.scrollWidth - element.clientWidth > 1);
    };
    // MathJax lays out after the value lands, so the first read waits a frame
    // rather than measuring a box that is still empty.
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // `resolve` is read through a ref so a fresh closure each render doesn't
    // tear the observer down and rebuild it on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return overflowing;
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

function EquationPanelContent({ shape }: { shape: EquationShape }) {
  const shapeId = shape.id;
  const inline = shape.props.inline ?? false;
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const inputVersion = useRef(0);
  const focusFrame = useRef(0);
  const copiedTimer = useRef<number | null>(null);
  const pendingWrap = useRef<{ index: number; text: string } | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [suggestions, setSuggestions] = useState<LatexCompletion[]>([]);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    let active = true;
    aiLatexEnabled().then((enabled) => {
      if (active) setAiEnabled(enabled);
    });
    return () => {
      active = false;
    };
  }, []);

  // Always include the equation's own color: a shape can carry a value the
  // current theme's palette doesn't hold, and a grid with nothing selected
  // reads as "no color set".
  const colors = paletteColors(theme);
  const swatches = colors.some((c) => c.value === shape.props.color)
    ? colors
    : [...colors, { name: 'Current color', value: shape.props.color }];
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

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

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
      cancelAnimationFrame(focusFrame.current);
    },
    [],
  );

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
  const titleId = `equation-panel-title-${shape.id}`;
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

  const previewOverflowing = useOverflowing(
    () => previewRef.current,
    currentKey,
  );

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

  /**
   * Ask the model to write LaTeX for a plain-language description.
   *
   * Written through `updateLatex` rather than `applyEdit`: the latter types
   * through the source field's own undo stack, which only works while that
   * field already has focus — here it's the prompt field that does.
   */
  const generateFromPrompt = async () => {
    const text = prompt.trim();
    if (!text || generating) return;
    setGenerating(true);
    try {
      const latex = await latexFromPrompt(text);
      updateLatex(latex);
      setPrompt('');
      focusInput();
    } catch (err) {
      toast.add({
        title: err instanceof Error ? err.message : 'Generation failed',
        type: 'error',
      });
    } finally {
      setGenerating(false);
    }
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

  const applyColor = (color: string) => {
    editor.updateShape(shape.id, { props: { color } });
  };

  const moveSwatchFocus = (from: number, delta: number) => {
    const next = (from + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    applyColor(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  const applyFontSize = (fontSize: number) => {
    const current = editor.getShape(shape.id);
    if (current?.type !== 'equation') return;
    const scale = fontSize / current.props.fontSize;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const w = current.props.w * scale;
    const h = current.props.h * scale;
    editor.updateShape(shape.id, {
      ...centeredMove(current, w, h),
      props: { fontSize, w, h },
    });
  };

  const copyLatex = async (bodyOnly: boolean) => {
    const text = bodyOnly
      ? shape.props.latex
      : wrapMathLatex(shape.props.latex, inline);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
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

  // A tinted tray holding two inset white cards: the equation itself above,
  // and how it is set below. Same construction as the graph panel, so the two
  // contextual panels read as one family — and so each group of controls is
  // stated by a card it stands in rather than by the gap above it.
  return (
    <TooltipProvider delay={300}>
      <Surface
        role="region"
        aria-labelledby={titleId}
        mode="docked"
        className="touch-targets flex max-h-[calc(100dvh-7rem-env(safe-area-inset-top))] w-[min(23rem,calc(100vw-2rem))] flex-col gap-1 overflow-hidden p-1 shadow-e2 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
      >
        {/* On the tray, above both cards: what this panel is, and the two
            actions that are about the equation as a whole rather than about
            anything inside one card. */}
        <h2 id={titleId} className="sr-only">
          Equation
        </h2>
        <header className="flex shrink-0 items-center justify-end gap-0.5 px-2 pt-0.5">
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Add equation below"
                    disabled={!currentKey}
                    onClick={addEquationBelow}
                    className="rounded-lg disabled:opacity-40"
                  />
                }
              >
                <CornerDownLeft className="size-4" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="top">
                Add equation below (⌘/Ctrl + Enter)
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={copied ? 'LaTeX copied' : 'Copy LaTeX'}
                    disabled={!currentKey}
                    onClick={(event) => void copyLatex(event.altKey)}
                    className="rounded-lg disabled:opacity-40"
                  />
                }
              >
                {copied ? (
                  <Check className="size-4 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </TooltipTrigger>
              <TooltipContent side="top">
                Copy as {inline ? 'inline' : 'display'} math (Alt: body only)
              </TooltipContent>
            </Tooltip>
          </div>
        </header>

        {/* Card one: the equation. Source in, preview out, and anything wrong
            with it named in between. This is the only part that scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col divide-y divide-border/60 overflow-y-auto overscroll-contain rounded-overlay border border-border bg-surface shadow-e1 [--chrome-hover:var(--color-panel)]">
          {/* Plain-language description → LaTeX, via the model. Only shown where
              the server is actually configured to answer it. */}
          {aiEnabled ? (
            <section
              aria-label="Generate from a description"
              className="p-3"
            >
              <div className="flex items-start gap-1.5">
                <Textarea
                  aria-label="Describe an equation to generate its LaTeX"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' || event.shiftKey) return;
                    event.preventDefault();
                    void generateFromPrompt();
                  }}
                  placeholder="Describe an equation… “quadratic equation”"
                  rows={1}
                  disabled={generating}
                  className="min-h-9 flex-1 resize-none rounded-lg py-2 text-sm text-fg"
                />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label="Generate LaTeX"
                        disabled={!prompt.trim() || generating}
                        onClick={() => void generateFromPrompt()}
                        className="mt-0.5 size-9 shrink-0 rounded-lg"
                      />
                    }
                  >
                    {generating ? (
                      <Loader2
                        className="size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Sparkles className="size-4" aria-hidden="true" />
                    )}
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Generate from description
                  </TooltipContent>
                </Tooltip>
              </div>
            </section>
          ) : null}

          {/* Source field, with the completion list hanging off its bottom edge. */}
          <section
            aria-label="LaTeX source"
            className="p-3"
          >
            <div className="relative">
              <Textarea
                ref={sourceRef}
                id={sourceId}
                aria-label="LaTeX source"
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
                className="min-h-24 w-full resize-y rounded-lg font-mono text-sm leading-5 text-fg"
              />

              {suggestions.length ? (
                <ul
                  id={listId}
                  role="listbox"
                  aria-label="LaTeX commands"
                  className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-overlay border border-border bg-surface p-1 shadow-e3"
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
                        'flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2 py-1.5',
                        index === activeSuggestion && 'bg-panel',
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
          </section>

          {/* Live canvas preview. */}
          <section aria-label="Preview" className="p-3">
            <div
              ref={previewRef}
              data-overflow={previewOverflowing ? true : undefined}
              aria-busy={previewStale || undefined}
              className="equation-fade-end equation-preview-box scrollbar-none flex min-h-16 items-center justify-center overflow-x-auto rounded-lg bg-panel p-3 text-center"
            >
              {!ready && !loadError ? (
                <span role="status" className="text-xs text-fg-muted">
                  Preparing renderer — what you type is saved.
                </span>
              ) : !currentKey ? (
                <span role="status" className="text-xs text-fg-muted">
                  Start typing to preview the equation.
                </span>
              ) : previewRender ? (
                <div
                  role="img"
                  aria-label={`Preview of equation: ${currentKey}`}
                  className={cn(
                    'equation-output-preview',
                    previewStale && 'opacity-60',
                  )}
                  style={{ color: shape.props.color }}
                  dangerouslySetInnerHTML={{ __html: previewRender.svg }}
                />
              ) : (
                <span role="status" className="text-xs text-fg-muted">
                  Rendering…
                </span>
              )}
            </div>
          </section>

          {error ? (
            <div className="p-3">
              <div
                id={errorId}
                role="alert"
                className="flex flex-col gap-1.5 rounded-lg border border-danger-border bg-danger-bg p-2.5 text-xs"
              >
                <div className="flex items-start gap-1.5">
                  <AlertCircle
                    className="mt-0.5 size-3.5 shrink-0 text-danger"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 text-danger">{error}</span>
                </div>
                {errorExcerpt ? (
                  <button
                    type="button"
                    onClick={() => errorSpan && focusInput(errorSpan)}
                    className="min-w-0 truncate rounded-md border border-danger-border/50 bg-surface/90 px-1.5 py-1 text-left font-mono text-2xs text-danger"
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
              Suppressed once MathJax has failed: the block above is then saying
              the same thing with the renderer's own words. */}
          {!error && problem && problemExcerpt ? (
            <div className="p-3">
              <div
                id={problemId}
                role="status"
                className="flex flex-col gap-1.5 rounded-lg border border-warning-border bg-warning-bg p-2.5 text-xs"
              >
                <div className="flex items-start gap-1.5">
                  <AlertCircle
                    className="mt-0.5 size-3.5 shrink-0 text-warning"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 text-warning">
                    {problem.message}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => focusInput(problem.span)}
                    className="min-w-0 flex-1 truncate rounded-md border border-warning-border/60 bg-surface/90 px-1.5 py-1 text-left font-mono text-2xs text-warning"
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
                    size="sm"
                    // Keep the caret in the field: the repair is written through
                    // the field's own insertion path, which needs it focused to
                    // land on the undo stack.
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => applyEdit(problem.fix)}
                    className="h-6 shrink-0 rounded-md px-2 text-2xs font-medium text-warning hover:bg-warning/10"
                  >
                    {problem.action}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Card two: colour, size and style — the only things about an equation
            that aren't in its source, and so the only controls left. Each is a
            labelled row, ruled off from the next. */}
        <div className="flex shrink-0 flex-col divide-y divide-border/60 rounded-overlay border border-border bg-surface shadow-e1 [--chrome-hover:var(--color-panel)]">
          <section
            aria-label="Color"
            className="p-2.5"
          >
            <div
              role="radiogroup"
              aria-label="Equation color"
              className="grid grid-cols-4 gap-1.5"
            >
              {swatches.map((paletteColor, index) => {
                const active = shape.props.color === paletteColor.value;
                return (
                  <Tooltip key={paletteColor.value}>
                    <TooltipTrigger
                      render={
                        <button
                          ref={(node) => {
                            swatchRefs.current[index] = node;
                          }}
                          type="button"
                          role="radio"
                          aria-label={paletteColor.name}
                          aria-checked={active}
                          tabIndex={active ? 0 : -1}
                          onClick={() => applyColor(paletteColor.value)}
                          onKeyDown={(event) => {
                            const delta =
                              event.key === 'ArrowRight' ||
                              event.key === 'ArrowDown'
                                ? 1
                                : event.key === 'ArrowLeft' ||
                                    event.key === 'ArrowUp'
                                  ? -1
                                  : 0;
                            if (!delta) return;
                            event.preventDefault();
                            moveSwatchFocus(index, delta);
                          }}
                          className="flex h-8 w-full items-center justify-center rounded-md transition-colors duration-150 ease-out hover:bg-panel active:scale-[0.98] motion-reduce:transition-none"
                        />
                      }
                    >
                      <span
                        className={cn(
                          'size-5 rounded-full border',
                          active &&
                            'ring-2 ring-ring ring-offset-2 ring-offset-surface',
                        )}
                        style={{
                          backgroundColor: paletteColor.value,
                          borderColor: swatchBorder(paletteColor.value),
                        }}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {paletteColor.name}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          </section>

          <section
            aria-label="Size"
            className="flex items-center p-2.5"
          >
            <ToggleGroup
              className={SEGMENTED_TRACK}
              spacing={0.5}
              aria-label="Equation size"
              value={[String(Math.round(shape.props.fontSize))]}
              onValueChange={(values) => {
                const next = values[0];
                if (next) applyFontSize(Number(next));
              }}
            >
              {FONT_SIZES.map((size) => (
                <Tooltip key={size}>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem
                        className={SEGMENTED_ITEM}
                        value={String(size)}
                        aria-label={`Size ${size}`}
                      />
                    }
                  >
                    {size}
                  </TooltipTrigger>
                  <TooltipContent side="top">Size {size}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </section>

          {/* Display or text style. Not a property of the source — the same
              LaTeX is valid in both — so it belongs beside colour and size
              rather than in the field. */}
          <section
            aria-label="Style"
            className="flex items-center p-2.5"
          >
            <ToggleGroup
              className={SEGMENTED_TRACK}
              spacing={0.5}
              aria-label="Equation style"
              value={[inline ? 'inline' : 'display']}
              onValueChange={(values) => {
                const next = values[0];
                if (next) applyInline(next === 'inline');
              }}
            >
              {STYLES.map((style) => (
                <Tooltip key={style.label}>
                  <TooltipTrigger
                    render={
                      <ToggleGroupItem
                        className={SEGMENTED_ITEM}
                        value={style.inline ? 'inline' : 'display'}
                        aria-label={style.label}
                      />
                    }
                  >
                    {style.label}
                  </TooltipTrigger>
                  <TooltipContent side="top">{style.hint}</TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
          </section>
        </div>
      </Surface>
    </TooltipProvider>
  );
}

export function EquationPanel() {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Subscribe to the one selected shape, not the whole page record — see the
  // same note in graph-panel.tsx.
  const selectedShape = useDocumentStore((state) =>
    selectedId ? state.shapesById.get(selectedId) : undefined,
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
