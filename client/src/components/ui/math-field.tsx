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
      >;
    }
  }
}

// The mathfield reads and writes expressions as ASCII math (`sin(x)`, `x^2`,
// `(a)/(b)`), which is the syntax the graph parser already understands.
const FORMAT = 'ascii-math';

export interface MathFieldProps {
  /** Current expression as ASCII math. */
  value: string;
  onChange: (value: string) => void;
  /** Enter inside the field — used to add and focus a new expression row. */
  onEnter?: () => void;
  /** Backspace while the field is empty — used to delete the row. */
  onBackspaceEmpty?: () => void;
  placeholder?: string;
  className?: string;
  id?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  /** Receives the underlying element so callers can focus a specific row. */
  elementRef?: (el: MathfieldElement | null) => void;
}

export function MathField({
  value,
  onChange,
  onEnter,
  onBackspaceEmpty,
  placeholder,
  className,
  elementRef,
  ...attrs
}: MathFieldProps) {
  const ref = React.useRef<MathfieldElement | null>(null);

  // Keep the latest callbacks reachable from listeners bound once on mount.
  const handlers = React.useRef({ onChange, onEnter, onBackspaceEmpty });
  handlers.current = { onChange, onEnter, onBackspaceEmpty };

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

    mf.mathVirtualKeyboardPolicy = 'manual';
    mf.smartFence = true;
    mf.smartSuperscript = true;
    // No right-click math menu or inline keyboard toggle in this compact panel.
    mf.menuItems = [];
    if (placeholder) mf.setAttribute('placeholder', placeholder);
    if (mf.getValue(FORMAT) !== value) {
      mf.setValue(value, { format: FORMAT, silenceNotifications: true });
    }

    const onInput = () => handlers.current.onChange(mf.getValue(FORMAT));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && handlers.current.onEnter) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onEnter();
      } else if (
        event.key === 'Backspace' &&
        handlers.current.onBackspaceEmpty &&
        mf.getValue(FORMAT).trim() === ''
      ) {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onBackspaceEmpty();
      }
    };

    mf.addEventListener('input', onInput);
    // Capture phase so we preempt the mathfield's own key handling.
    mf.addEventListener('keydown', onKeyDown, { capture: true });
    return () => {
      mf.removeEventListener('input', onInput);
      mf.removeEventListener('keydown', onKeyDown, { capture: true });
    };
    // Bind once; value/placeholder syncing is handled by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reflect external value changes (undo, slider edits, programmatic resets)
  // without clobbering the value the user is actively typing.
  React.useEffect(() => {
    const mf = ref.current;
    if (mf && mf.getValue(FORMAT) !== value) {
      mf.setValue(value, { format: FORMAT, silenceNotifications: true });
    }
  }, [value]);

  return (
    <math-field
      ref={setRef}
      className={cn('graph-math-field', className)}
      {...attrs}
    />
  );
}
