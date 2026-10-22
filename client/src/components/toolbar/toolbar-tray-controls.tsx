import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { KeyTip, useToolbarSide } from './toolbar-primitives';

/**
 * The style tray's two controls: a segmented row for one choice among a few,
 * and a menu key that shows a setting's value and opens its controls.
 */

/** −1 for a backwards arrow, 1 for a forwards one, 0 for anything else. */
export function arrowDelta(key: string): number {
  if (key === 'ArrowRight' || key === 'ArrowDown') return 1;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return -1;
  return 0;
}

export function useCloseWithBar(visible: boolean, close: (open: boolean) => void) {
  useEffect(() => {
    if (!visible) close(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
}

interface SegmentOption<T> {
  value: T;
  label: string;
  glyph: ReactNode;
  style?: CSSProperties;
  /** The visible name, on a `labelled` row. */
  text?: string;
}

/** Arrows move the choice and focus follows it, wrapping at either end. */
function useRadioKeys<T>(
  options: SegmentOption<T>[],
  value: T,
  onSelect: (value: T) => void,
) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = options.findIndex((option) => option.value === value);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const next =
      (Math.max(index, 0) + delta + options.length) % options.length;
    onSelect(options[next]!.value);
    refs.current[next]?.focus();
  };
  return { refs, index, onKeyDown };
}

/**
 * A tool's defining choice, out in the tray rather than behind a menu: each
 * option drawn in a full-height slot like the shape tray's, the one in use
 * recessed.
 */
export function TrayCells<T extends string | number>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onSelect: (value: T) => void;
}) {
  const { refs, index, onKeyDown } = useRadioKeys(options, value, onSelect);
  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="tray-shapes tray-open"
      // Share the row by option count, so every slot comes out one width.
      style={{ flexGrow: options.length }}
    >
      {options.map((option, i) => (
        <Tooltip key={String(option.value)}>
          <TooltipTrigger
            render={
              <button
                ref={(node) => {
                  refs.current[i] = node;
                }}
                type="button"
                role="radio"
                aria-label={option.label}
                aria-checked={i === index}
                tabIndex={i === index || (index < 0 && i === 0) ? 0 : -1}
                onClick={() => onSelect(option.value)}
                className="tray-cell"
                style={option.style}
              />
            }
          >
            {option.glyph}
          </TooltipTrigger>
          <KeyTip label={option.label} />
        </Tooltip>
      ))}
    </div>
  );
}

/**
 * One choice among a few: a radiogroup with a single pill that travels to the
 * chosen segment. Every setting on the bar is one of these,
 * so they all look and behave alike — arrows move the choice, and focus
 * follows it.
 */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onSelect,
  tooltips = false,
  labelled = false,
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onSelect: (value: T) => void;
  /** Name each segment on hover, for rows with no visible label. */
  tooltips?: boolean;
  /** Each segment shows its glyph and then its name. */
  labelled?: boolean;
}) {
  const { refs, index, onKeyDown } = useRadioKeys(options, value, onSelect);

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn('tbar-seg shrink-0', labelled && 'tbar-seg-labelled')}
    >
      <span
        aria-hidden="true"
        className={cn('tbar-chip', index < 0 && 'opacity-0')}
        style={
          {
            '--seg-count': options.length,
            '--seg-index': Math.max(index, 0),
          } as CSSProperties
        }
      />
      {options.map((option, i) => {
        const checked = i === index;
        const props: React.ComponentProps<'button'> = {
          ref: (node) => {
            refs.current[i] = node;
          },
          type: 'button',
          role: 'radio',
          // A labelled segment is named by its visible text.
          'aria-label': labelled ? undefined : option.label,
          'aria-checked': checked,
          // With nothing chosen (a mixed selection) the first segment holds
          // the group's tab stop.
          tabIndex: checked || (index < 0 && i === 0) ? 0 : -1,
          onClick: () => onSelect(option.value),
          className: 'tbar-item',
          style: option.style,
        };
        return tooltips ? (
          <Tooltip key={String(option.value)}>
            <TooltipTrigger render={<button {...props} />}>
              {option.glyph}
            </TooltipTrigger>
            <KeyTip label={option.label} />
          </Tooltip>
        ) : (
          <button key={String(option.value)} {...props}>
            {option.glyph}
            {labelled ? <span>{option.text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** A setting shown as its current value with a chevron, opening its controls. */
export function TrayMenu({
  label,
  value,
  barVisible,
  checked,
  children,
}: {
  label: string;
  value: ReactNode;
  barVisible: boolean;
  /** The thing in hand is one of the choices inside. */
  checked?: boolean;
  children: ReactNode | ((close: () => void) => ReactNode);
}) {
  const side = useToolbarSide();
  const [open, setOpen] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  useCloseWithBar(barVisible, setOpen);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-checked={checked || undefined}
            className="tray-menu"
          />
        }
      >
        {value}
        <ChevronDown aria-hidden="true" className="tray-chevron" />
      </PopoverTrigger>
      <PopoverContent
        ref={popup}
        // Opened by pointer, focus rests on the panel, so no choice inside
        // wears a focus ring; by keyboard it goes to the first choice.
        initialFocus={(type) => (type === 'keyboard' ? true : popup.current)}
        side={side}
        sideOffset={8}
        className="tbar-surface tbar-panel tray-panel w-auto flex-col items-start"
      >
        {typeof children === 'function' ? children(() => setOpen(false)) : children}
      </PopoverContent>
    </Popover>
  );
}
