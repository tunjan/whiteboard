import { useRef, useState } from 'react';
import {
  rampColors,
  useStyleStore,
  type PaletteColor,
} from '@/canvas/use-style-store';
import { ColorEditor } from '@/components/color-editor';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { swatchBorder } from '@/lib/utils';
import {
  KeyTip,
  refocusForKeyboard,
  ToolbarItem,
  useToolbarSide,
} from './toolbar-primitives';
import { arrowDelta, useCloseWithBar } from './toolbar-tray-controls';

function Swatch({
  swatch,
  selected,
  tabStop,
  onSelect,
  buttonRef,
  hotkey,
}: {
  swatch: PaletteColor;
  selected: boolean;
  tabStop: boolean;
  onSelect: () => void;
  buttonRef?: (node: HTMLButtonElement | null) => void;
  hotkey?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            ref={buttonRef}
            type="button"
            role="radio"
            aria-label={swatch.name}
            aria-checked={selected}
            aria-keyshortcuts={hotkey}
            tabIndex={tabStop ? 0 : -1}
            onClick={onSelect}
            className="tbar-item"
          />
        }
      >
        <span
          aria-hidden="true"
          className="tbar-swatch"
          style={{
            backgroundColor: swatch.value,
            borderColor: swatchBorder(swatch.value),
          }}
        />
      </TooltipTrigger>
      <KeyTip label={swatch.name} hotkey={hotkey} />
    </Tooltip>
  );
}

/**
 * The user's colours, closed by a key that opens the colour panel: pick from
 * the whole set, take colours off the bar, put palette or custom ones on.
 * That key is the ramp's last slot: a hollow spectrum at rest, so it is not
 * taken for one more colour, and the chosen colour
 * itself — ringed — when the choice is not one of the swatches showing.
 *
 * The bar shows the first `count` (all of them when unset) and the panel
 * holds the rest.
 */
export function ColorRamp({
  color,
  onSelect,
  barVisible,
  count,
}: {
  color: string;
  onSelect: (value: string) => void;
  barVisible: boolean;
  count?: number;
}) {
  const side = useToolbarSide();
  const theme = useThemeStore((s) => s.theme);
  const ramp = useStyleStore((s) => s.ramp);
  const all = rampColors(ramp, theme);
  const swatches = all.slice(0, count);
  const index = swatches.findIndex((swatch) => swatch.value === color);
  const onRamp = index >= 0;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const [open, setOpen] = useState(false);

  useCloseWithBar(barVisible, setOpen);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const index = refs.current.indexOf(event.target as HTMLButtonElement);
    const next = (index + delta + swatches.length) % swatches.length;
    onSelect(swatches[next]!.value);
    refs.current[next]?.focus();
  };

  const current = all.find((c) => c.value === color)?.name ?? color;

  return (
    <div className="tbar-group tbar-ramp shrink-0">
      <div
        role="radiogroup"
        aria-label="Color"
        onKeyDown={onKeyDown}
        className="relative flex items-center"
      >
        {/* One ring that travels, like the weight row's chip: the choice moves
            along the ramp rather than going out here and on there. */}
        <span
          aria-hidden="true"
          className="tbar-ramp-ring"
          data-off={onRamp ? undefined : ''}
          style={{ '--ramp-index': Math.max(index, 0) } as React.CSSProperties}
        />
        {swatches.map((swatch, i) => (
          <Swatch
            key={swatch.value}
            swatch={swatch}
            selected={swatch.value === color}
            tabStop={swatch.value === color || (!onRamp && i === 0)}
            onSelect={() => onSelect(swatch.value)}
            buttonRef={(node) => {
              refs.current[i] = node;
            }}
            hotkey={i < 8 ? String(i + 1) : undefined}
          />
        ))}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <ToolbarItem
          label={onRamp ? 'Colors' : `Colors, ${current} chosen`}
          tooltip={<span>Colors</span>}
          render={<PopoverTrigger />}
        >
          <span
            aria-hidden="true"
            className="tbar-swatch"
            data-selected={onRamp ? undefined : ''}
            data-wheel={onRamp ? '' : undefined}
            style={
              onRamp
                ? undefined
                : { backgroundColor: color, borderColor: swatchBorder(color) }
            }
          />
        </ToolbarItem>

        <PopoverContent
          side={side}
          align="end"
          // 8px past the tray's edge, which stands 10px above a swatch's key.
          sideOffset={side === 'top' ? 15 : 8}
          finalFocus={refocusForKeyboard}
          className="drawer-popup tbar-surface tbar-panel w-auto"
        >
          <PopoverHeader className="sr-only">
            <PopoverTitle>Colors</PopoverTitle>
          </PopoverHeader>
          <ColorEditor
            color={color}
            onSelect={onSelect}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
