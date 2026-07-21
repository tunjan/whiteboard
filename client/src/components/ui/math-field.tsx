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
  /** Arrow key pressed with nowhere to go inside the field — used to move
   * focus to the previous/next expression row (Desmos-style). */
  onMoveOut?: (direction: 'upward' | 'downward') => void;
  placeholder?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  /** Receives the underlying element so callers can focus a specific row. */
  elementRef?: (el: MathfieldElement | null) => void;
}

export function MathField({
  value,
  onChange,
  onEnter,
  onBackspaceEmpty,
  onMoveOut,
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
  const handlers = React.useRef({ onChange, onEnter, onBackspaceEmpty, onMoveOut });
  handlers.current = { onChange, onEnter, onBackspaceEmpty, onMoveOut };

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

    mf.addEventListener('input', onInput);
    // Capture phase so we preempt the mathfield's own key handling.
    mf.addEventListener('keydown', onKeyDown, { capture: true });
    mf.addEventListener('move-out', onMoveOutEvent);
    return () => {
      mf.removeEventListener('input', onInput);
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
      className={cn('graph-math-field', className)}
      {...attrs}
    />
  );
}
