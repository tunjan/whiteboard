import * as React from 'react';
// Importing 'mathlive' registers the <math-field> custom element as a side effect.
import { MathfieldElement } from 'mathlive';
// Ship MathLive's KaTeX fonts through the bundle (Vite resolves the relative
// font URLs and sets --ML__static-fonts), instead of fetching them at runtime.
import 'mathlive/fonts.css';
import { cn } from '@/lib/utils';

// Fonts come from the imported stylesheet; sounds are off in this panel.
MathfieldElement.fontsDirectory = null;
MathfieldElement.soundsDirectory = null;

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'math-field': React.DetailedHTMLProps<
        React.HTMLAttributes<MathfieldElement>,
        MathfieldElement
      > & {
        disabled?: boolean;
      };
    }
  }
}

export type MathFieldFormat = 'ascii-math' | 'latex';
export type MathFieldVirtualKeyboardPolicy = 'auto' | 'manual';

export interface MathFieldProps {
  /** Current expression in the selected output format. */
  value: string;
  onChange: (value: string) => void;
  /** Graphs use ASCII math; equation shapes use source LaTeX. */
  format?: MathFieldFormat;
  /** Whether MathLive opens its keyboard automatically or via an external control. */
  virtualKeyboardPolicy?: MathFieldVirtualKeyboardPolicy;
  /** Enter inside the field — used to add and focus a new expression row. */
  onEnter?: () => void;
  /** Backspace while the field is empty — used to delete the row. */
  onBackspaceEmpty?: () => void;
  /** Escape inside the field — used to hand focus back to the canvas. */
  onEscape?: () => void;
  /**
   * Rewrite pasted text before it is inserted. Returning the input unchanged
   * lets MathLive's own paste handling run, which keeps the native undo entry.
   */
  onPasteText?: (text: string) => string;
  /** Arrow key pressed with nowhere to go inside the field — used to move
   * focus to the previous/next expression row (Desmos-style). */
  onMoveOut?: (direction: 'upward' | 'downward') => void;
  placeholder?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
  /** Receives the underlying element so callers can focus a specific row. */
  elementRef?: (el: MathfieldElement | null) => void;
}

export function MathField({
  value,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onEscape,
  onMoveOut,
  onPasteText,
  placeholder,
  className,
  elementRef,
  format = 'ascii-math',
  virtualKeyboardPolicy = 'auto',
  ...attrs
}: MathFieldProps) {
  const ref = React.useRef<MathfieldElement | null>(null);
  const formatRef = React.useRef<MathFieldFormat>(format);
  formatRef.current = format;

  // Keep the latest callbacks reachable from listeners bound once on mount.
  const handlers = React.useRef({
    onChange,
    onEnter,
    onBackspaceEmpty,
    onEscape,
    onMoveOut,
    onPasteText,
  });
  handlers.current = {
    onChange,
    onEnter,
    onBackspaceEmpty,
    onEscape,
    onMoveOut,
    onPasteText,
  };

  const setRef = React.useCallback(
    (el: MathfieldElement | null) => {
      ref.current = el;
      elementRef?.(el);
    },
    [elementRef],
  );

  React.useEffect(() => {
    const mf = ref.current;
    if (!mf) return;

    // Desmos-style math keyboard on touch devices; desktop keeps the physical
    // keyboard only.
    mf.mathVirtualKeyboardPolicy = virtualKeyboardPolicy;
    mf.smartFence = true;
    mf.smartSuperscript = true;
    // No right-click math menu or inline keyboard toggle in this compact panel.
    mf.menuItems = [];
    if (placeholder) mf.setAttribute('placeholder', placeholder);
    if (mf.getValue(formatRef.current) !== value) {
      mf.setValue(value, {
        format: formatRef.current,
        silenceNotifications: true,
      });
    }

    const onInput = () =>
      handlers.current.onChange(mf.getValue(formatRef.current));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && handlers.current.onEnter) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onEnter();
      } else if (event.key === 'Escape' && handlers.current.onEscape) {
        event.preventDefault();
        event.stopPropagation();
        // Two-stage Escape while a `\command` is being typed. Swallowing every
        // Escape left a mistyped `\alph` with no way out but committing it —
        // and on a still-empty equation the caller's Escape deletes the shape,
        // so one keystroke lost the work.
        //
        // Cancelling explicitly rather than falling through to MathLive: its
        // own binding for this is *shift*+Escape, and plain Escape in LaTeX
        // mode is bound to nothing at all, so deferring would strand the user
        // in a mode with no exit.
        if (mf.mode === 'latex') {
          mf.executeCommand(['complete', 'reject']);
          return;
        }
        // Back in math mode, Escape means what the caller says it means.
        handlers.current.onEscape();
      } else if (
        event.key === 'Backspace' &&
        handlers.current.onBackspaceEmpty &&
        mf.getValue(formatRef.current).trim() === ''
      ) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onBackspaceEmpty();
      }
    };

    // Arrow up/down at the field boundary moves focus to the adjacent row.
    const onMoveOutEvent = (event: HTMLElementEventMap['move-out']) => {
      const { direction } = event.detail;
      if (
        (direction === 'upward' || direction === 'downward') &&
        handlers.current.onMoveOut
      ) {
        event.preventDefault();
        handlers.current.onMoveOut(direction);
      }
    };

    const onPaste = (event: ClipboardEvent) => {
      const transform = handlers.current.onPasteText;
      const pasted = event.clipboardData?.getData('text/plain');
      if (!transform || !pasted) return;
      const rewritten = transform(pasted);
      // Nothing to change: let MathLive paste it, so the native undo entry the
      // default action creates is preserved.
      if (rewritten === pasted) return;
      event.preventDefault();
      event.stopPropagation();
      mf.insert(rewritten, { format: 'latex', selectionMode: 'after' });
      handlers.current.onChange(mf.getValue(formatRef.current));
    };

    mf.addEventListener('input', onInput);
    mf.addEventListener('paste', onPaste, { capture: true });
    // Capture phase so we preempt the mathfield's own key handling.
    mf.addEventListener('keydown', onKeyDown, { capture: true });
    mf.addEventListener('move-out', onMoveOutEvent);
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('paste', onPaste, { capture: true });
      mf.removeEventListener('keydown', onKeyDown, { capture: true });
      mf.removeEventListener('move-out', onMoveOutEvent);
    };
    // Bind once; value/placeholder syncing is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external value changes (undo, slider edits, programmatic resets)
  // without clobbering the value the user is actively typing.
  React.useEffect(() => {
    const mf = ref.current;
    if (mf && mf.getValue(format) !== value) {
      mf.setValue(value, { format, silenceNotifications: true });
    }
  }, [format, value]);

  React.useEffect(() => {
    if (ref.current) {
      ref.current.mathVirtualKeyboardPolicy = virtualKeyboardPolicy;
    }
  }, [virtualKeyboardPolicy]);

  React.useEffect(() => {
    const mf = ref.current;
    if (!mf) return;
    if (placeholder) mf.setAttribute('placeholder', placeholder);
    else mf.removeAttribute('placeholder');
  }, [placeholder]);

  return (
    <math-field
      ref={setRef}
      className={cn('math-field-base', className)}
      {...attrs}
    />
  );
}
