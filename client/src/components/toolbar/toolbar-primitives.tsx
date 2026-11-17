import {
  cloneElement,
  createContext,
  useContext,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The toolbar's base layer: where its popups open, how a key's tooltip reads,
 * the plate and the tray's key. The drawer's slots (`toolbar-tool-button`) and
 * the style tray build on these; nothing here imports from either. The visual
 * rules all live in section 9 of `index.css`, keyed off these class names.
 */

/**
 * The side the bar's tooltips and menus open toward: away from the edge the
 * bar docks to, so nothing it opens lands off-screen or under the pointer.
 */
export const ToolbarSideContext = createContext<'top' | 'right'>('top');

export function useToolbarSide() {
  return useContext(ToolbarSideContext);
}

// The last input that was not Escape: Escape closes a menu whichever way it was
// opened, so it says nothing about how the user is working.
let usingKeyboard = false;
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', () => (usingKeyboard = false), true);
  window.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') usingKeyboard = true;
    },
    true,
  );
}

/**
 * A popup's `finalFocus`: focus goes back to its trigger only for someone
 * working by keyboard. After a pointer, a key left focused would light its
 * ring at the next hotkey.
 */
export const refocusForKeyboard = () => usingKeyboard;

/** A key's tooltip: its name, then its hotkey. */
export function KeyTip({
  label,
  hotkey,
}: {
  label: ReactNode;
  hotkey?: string;
}) {
  return (
    <TooltipContent side={useToolbarSide()}>
      {label}
      {hotkey ? <Kbd className="font-mono uppercase">{hotkey}</Kbd> : null}
    </TooltipContent>
  );
}

/**
 * The plate. The bar, a flyout and a menu are all made of this, so a control
 * and the thing it opens are visibly the same material.
 */
export function ToolbarSurface({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return <div {...props} className={cn('tbar-surface', className)} />;
}

interface ToolbarItemProps {
  /** The accessible name. Every key here is icon-only, so this is required. */
  label: string;
  /** Shown in the tooltip and announced as `aria-keyshortcuts`. */
  hotkey?: string;
  /**
   * The key is the one that is *on*: the held tool, the chosen option. Written
   * as `aria-current` for a tool among tools and as `aria-pressed` for a
   * standalone toggle — `mark` picks which.
   */
  selected?: boolean;
  mark?: 'current' | 'pressed' | 'checked';
  disabled?: boolean;
  /** Overrides the tooltip body, for a key whose tooltip is not just its name. */
  tooltip?: ReactNode;
  onClick?: () => void;
  tabIndex?: number;
  className?: string;
  style?: React.CSSProperties;
  /**
   * The element to render as, for a key that is also a menu or popover
   * trigger. Defaults to a plain button.
   */
  render?: ReactElement<Record<string, unknown>>;
  /** The glyph. */
  children: ReactNode;
}

/**
 * A key on the style tray.
 *
 * Its states — hover, press, selected, focus-visible, disabled — are all in
 * CSS, keyed off `.tbar-item` and the ARIA attribute this writes, so the same
 * attribute drives the pixels and the screen reader and the two cannot
 * disagree.
 */
export function ToolbarItem({
  label,
  hotkey,
  selected = false,
  mark = 'current',
  disabled = false,
  tooltip,
  onClick,
  tabIndex,
  className,
  style,
  render,
  children,
}: ToolbarItemProps) {
  const state: Record<string, unknown> = {
    'data-toolbar-item': '',
    'aria-label': label,
    'aria-keyshortcuts': hotkey?.toUpperCase(),
    className: cn('tbar-item', className),
    style,
    disabled: disabled || undefined,
    tabIndex,
    onClick,
  };
  if (mark === 'current') state['aria-current'] = selected ? 'true' : undefined;
  if (mark === 'pressed') state['aria-pressed'] = selected;
  if (mark === 'checked') state['aria-checked'] = selected;

  const trigger = cloneElement(
    render ?? <button type="button" />,
    state,
  );

  return (
    <Tooltip>
      <TooltipTrigger render={trigger}>{children}</TooltipTrigger>
      <KeyTip label={tooltip ?? <span>{label}</span>} hotkey={hotkey} />
    </Tooltip>
  );
}
