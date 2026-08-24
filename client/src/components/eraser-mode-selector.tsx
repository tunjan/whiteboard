import { useCanvasUiStore, type EraserMode } from '@/canvas/use-canvas-ui-store';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Whole shapes: a closed box, which is the smallest thing that reads as "an
 * object" at this size. Drawn at the same 16px viewBox and 1.75 weight as its
 * sibling below so the two glyphs sit on one optical line.
 */
function ObjectGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x={3}
        y={3}
        width={10}
        height={10}
        rx={2.5}
        fill="currentColor"
        fillOpacity={0.18}
        stroke="currentColor"
        strokeWidth={1.75}
      />
    </svg>
  );
}

/** A stroke with a bite taken out of its middle: what precision mode does. */
function PrecisionGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M2 11 A 6 6 0 0 1 5.95 5.36 M10.05 5.36 A 6 6 0 0 1 14 11"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
      />
    </svg>
  );
}

const MODES: {
  mode: EraserMode;
  label: string;
  Glyph: () => React.JSX.Element;
}[] = [
  {
    mode: 'object',
    label: 'Object eraser',
    Glyph: ObjectGlyph,
  },
  {
    mode: 'precision',
    label: 'Precision eraser',
    Glyph: PrecisionGlyph,
  },
];

/**
 * The eraser's two modes, as a satellite of the eraser's own tool button.
 *
 * It anchors to that button rather than living in the top-right style panel:
 * the mode belongs to the tool, so it reads as part of it and lands where the
 * pointer already is. Nothing else in the bar moves when it appears — it floats
 * in the gutter above, in the toolbar's own surface and motion idiom.
 *
 * Mounted at all times and hidden with opacity, so it animates out as well as
 * in; `inert` keeps the hidden copy out of the tab order and off the a11y tree.
 * Callers must place it inside a positioned ancestor that wraps the button.
 */
export function EraserModeSelector({ active }: { active: boolean }) {
  const eraserMode = useCanvasUiStore((s) => s.eraserMode);
  const setEraserMode = useCanvasUiStore((s) => s.setEraserMode);
  const selectedIndex = MODES.findIndex(({ mode }) => mode === eraserMode);

  // Radiogroup convention: arrows move the choice, which for two options is a
  // flip either way. This is also the eraser hotkey's behaviour (press E while
  // erasing), so the two paths agree.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const next = MODES[(selectedIndex + 1) % MODES.length];
    if (!next) return;
    setEraserMode(next.mode);
    // Focus follows the selection, as in a radiogroup.
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-mode="${next.mode}"]`)
      ?.focus();
  };

  return (
    // `w-max` is load-bearing. The containing block is the 40px tool button, so
    // shrink-to-fit offers this pill only the 20px right of its own midpoint,
    // and `grid-cols-2` is minmax(0,1fr) — tracks that will collapse to nothing
    // and let their contents overlap rather than widen the box. Sizing to
    // max-content also keeps the -translate-x-1/2 centring honest.
    <div className="absolute bottom-full left-1/2 mb-3.5 w-max -translate-x-1/2">
      <Surface
        mode="floating"
        chrome
        aria-hidden={!active}
        inert={!active}
        className={cn(
          'rounded-xl border border-border/80 bg-surface/92 p-1 shadow-e4',
          'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
          'motion-reduce:transition-none',
          active
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-1 scale-95 opacity-0',
        )}
      >
        <div
          role="radiogroup"
          aria-label="Eraser mode"
          onKeyDown={onKeyDown}
          className="relative grid grid-cols-2"
        >
          {/* The chosen mode as a fill that slides between the two segments:
              one moving mark instead of two chips lighting up, which is what
              makes the pair read as a single switch. It takes the quieter
              pressed idiom — the accent chip is already spent on the eraser
              button below, and only the active glyph carries the hue. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute inset-y-0 left-0 w-1/2 rounded-lg border border-border-strong/60 bg-panel shadow-xs',
              'transition-transform duration-base ease-out-quart motion-reduce:transition-none',
              eraserMode === 'precision' && 'translate-x-full',
            )}
          />
          {MODES.map(({ mode, label, Glyph }) => {
            const selected = mode === eraserMode;
            return (
              <Tooltip key={mode}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      role="radio"
                      data-mode={mode}
                      aria-label={label}
                      aria-checked={selected}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setEraserMode(mode)}
                      className={cn(
                        'relative z-10 flex size-8 items-center justify-center rounded-lg',
                        'transition-colors duration-fast ease-out-quart motion-reduce:transition-none',
                        selected
                          ? 'text-fg font-medium'
                          : 'text-fg-muted hover:text-fg',
                      )}
                    />
                  }
                >
                  <Glyph />
                </TooltipTrigger>
                <TooltipContent side="top">{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </Surface>
    </div>
  );
}
