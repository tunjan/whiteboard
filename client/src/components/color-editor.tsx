import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  allSwatches,
  paletteColors,
  rampColors,
  useStyleStore,
  type PaletteColor,
} from '@/canvas/use-style-store';
import { CloseGlyph, PlusGlyph, UndoGlyph } from '@/components/ui/glyphs';
import { useThemeStore } from '@/use-theme-store';
import { swatchBorder } from '@/lib/utils';

function SwatchKey({
  swatch,
  label,
  pressed,
  onClick,
}: {
  swatch: PaletteColor;
  label: string;
  pressed?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={label}
      onClick={onClick}
      className="tbar-item aria-pressed:bg-transparent"
    >
      <span
        aria-hidden="true"
        className="tbar-swatch"
        data-selected={pressed ? '' : undefined}
        style={{
          backgroundColor: swatch.value,
          borderColor: swatchBorder(swatch.value),
        }}
      />
    </button>
  );
}

/**
 * The system colour picker, as a key. It adds on `change` — when the picker
 * is closed on a choice — not on React's `onChange`, which is the `input`
 * event and fires for every colour the pointer passes over.
 */
function CustomColorKey({ onPick }: { onPick: (value: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(onPick);
  latest.current = onPick;

  useEffect(() => {
    const node = input.current;
    if (!node) return;
    const onChange = () => latest.current(node.value);
    node.addEventListener('change', onChange);
    return () => node.removeEventListener('change', onChange);
  }, []);

  return (
    <label title="Custom color" className="tbar-item tbar-custom-color">
      <PlusGlyph aria-hidden="true" />
      <input
        ref={input}
        type="color"
        aria-label="Add a custom color"
        className="sr-only"
      />
    </label>
  );
}

/** How far a press travels before it is a drag rather than a click, in px. */
const DRAG_THRESHOLD = 5;
/** Columns in the panel's grids; Alt+Up/Down moves a colour by a row. */
const COLUMNS = 6;

const tileIndex = (target: EventTarget | null): number => {
  const tile = (target as Element | null)?.closest?.('[data-ramp-index]');
  return tile ? Number(tile.getAttribute('data-ramp-index')) : -1;
};

/**
 * Drag a colour to a new place on the bar, or move it with Alt+arrows.
 *
 * The colour moves as soon as the pointer is over another tile, so the grid
 * itself is the drop preview. Capture is taken on the grid, not the tile —
 * React moves the tile's node as the order changes, and a node that leaves
 * the document drops its capture — and only once the press has travelled, so
 * a plain click still lands on the swatch underneath.
 */
function useReorder(onMove: (from: number, to: number) => void) {
  const press = useRef<{
    index: number;
    x: number;
    y: number;
    pointerId: number;
    dragging: boolean;
  } | null>(null);
  const [dragging, setDragging] = useState(-1);

  const end = () => {
    press.current = null;
    setDragging(-1);
  };

  return {
    dragging,
    gridProps: {
      onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => {
        const index = tileIndex(event.target);
        if (index < 0 || event.button !== 0) return;
        press.current = {
          index,
          x: event.clientX,
          y: event.clientY,
          pointerId: event.pointerId,
          dragging: false,
        };
      },
      onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => {
        const current = press.current;
        if (!current || current.pointerId !== event.pointerId) return;
        if (!current.dragging) {
          const travel = Math.hypot(
            event.clientX - current.x,
            event.clientY - current.y,
          );
          if (travel <= DRAG_THRESHOLD) return;
          current.dragging = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(current.index);
        }
        const over = tileIndex(
          document.elementFromPoint(event.clientX, event.clientY),
        );
        if (over < 0 || over === current.index) return;
        onMove(current.index, over);
        current.index = over;
        setDragging(over);
      },
      onPointerUp: end,
      onPointerCancel: end,
      onLostPointerCapture: end,
      onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (!event.altKey) return;
        const step = {
          ArrowLeft: -1,
          ArrowRight: 1,
          ArrowUp: -COLUMNS,
          ArrowDown: COLUMNS,
        }[event.key];
        const from = tileIndex(event.target);
        if (!step || from < 0) return;
        event.preventDefault();
        // The canvas reads arrows off `window` to nudge the selection.
        event.stopPropagation();
        const grid = event.currentTarget;
        const to = Math.min(
          Math.max(from + step, 0),
          grid.querySelectorAll('[data-ramp-index]').length - 1,
        );
        if (to === from) return;
        onMove(from, to);
        // Keep the moved colour focused so the keys repeat on it.
        requestAnimationFrame(() =>
          grid
            .querySelector<HTMLElement>(`[data-ramp-index="${to}"] > button`)
            ?.focus(),
        );
      },
    },
  };
}

/**
 * The toolbar's colours and where they come from: the colours on the bar
 * (pick one, drag it into place, or take it off), then the palette colours that are not on it and
 * a custom colour from the system picker (either goes onto the bar).
 */
export function ColorEditor({
  color,
  onSelect,
  onDone,
}: {
  color: string;
  onSelect: (value: string) => void;
  /** A colour on the bar was chosen; the caller closes its popover. */
  onDone: () => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const ramp = useStyleStore((s) => s.ramp);
  const { addRampColor, removeRampColor, moveRampColor, resetRamp } =
    useStyleStore.getState();
  const { dragging, gridProps } = useReorder(moveRampColor);
  const swatches = rampColors(ramp, theme);
  const spare = allSwatches(paletteColors(theme)).filter(
    (c) => !swatches.some((s) => s.value === c.value),
  );

  const add = (value: string) => {
    addRampColor(value);
    onSelect(value);
  };

  return (
    <div className="tbar-colors">
      <div
        role="group"
        aria-label="Toolbar colors"
        aria-description="Drag, or Alt and an arrow key, to reorder"
        className="tbar-colors-ramp grid grid-cols-6"
        {...gridProps}
      >
        {swatches.map((swatch, i) => (
          <div
            key={swatch.value}
            data-ramp-index={i}
            data-dragging={dragging === i || undefined}
            className="group relative"
          >
            <SwatchKey
              swatch={swatch}
              label={swatch.name}
              pressed={swatch.value === color}
              onClick={() => {
                onSelect(swatch.value);
                onDone();
              }}
            />
            {swatches.length > 1 && (
              <button
                type="button"
                aria-label={`Remove ${swatch.name} from the toolbar`}
                title="Remove"
                onClick={() => removeRampColor(i)}
                className="tbar-swatch-remove touch-reveal opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              >
                <CloseGlyph aria-hidden="true" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div role="group" aria-label="Add a color" className="tbar-colors-add grid grid-cols-6">
        {spare.map((swatch) => (
          <SwatchKey
            key={swatch.value}
            swatch={swatch}
            label={`Add ${swatch.name}`}
            onClick={() => add(swatch.value)}
          />
        ))}
        <CustomColorKey onPick={add} />
        {ramp && (
          <button
            type="button"
            aria-label="Restore the default colors"
            title="Restore the default colors"
            onClick={resetRamp}
            className="tbar-item"
          >
            <UndoGlyph aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
