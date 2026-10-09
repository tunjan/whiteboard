import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * The toolbar's component set.
 *
 * Four pieces — a surface, a group, a separator and a key — and every control
 * on the bar is one of them. Nothing on the bar styles itself: a call site
 * chooses a variant, never a colour, a radius or a size, so the row cannot
 * drift apart one button at a time. The visual rules all live in section 9 of
 * `index.css`, keyed off these class names.
 */

/** The wedge on a key that opens a menu. */
function Caret() {
  return (
    <svg
      className="tbar-caret"
      viewBox="0 0 4 4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M4 4H0L4 0Z" />
    </svg>
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

/**
 * A run of related keys, named for assistive technology. Groups are what the
 * separators separate; the bar has no other structure.
 */
export function ToolbarGroup({
  label,
  className,
  ...props
}: { label: string } & React.ComponentProps<'div'>) {
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      className={cn('tbar-group', className)}
    />
  );
}

/** The rule between two groups. */
export function ToolbarSeparator() {
  return (
    <span
      className="tbar-sep"
      role="separator"
      aria-orientation="vertical"
    />
  );
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
  /** The key opens a menu or a flyout, and says so with a wedge. */
  caret?: boolean;
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
 * A key on the bar.
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
  caret = false,
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
      <TooltipTrigger render={trigger}>
        {children}
        {caret ? <Caret /> : null}
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        {tooltip ?? <span>{label}</span>}
        {hotkey ? <Kbd className="font-mono uppercase">{hotkey}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}
