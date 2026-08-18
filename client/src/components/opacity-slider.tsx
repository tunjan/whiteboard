import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from '@/lib/utils';

/**
 * A fader, not a generic range input: a wide capsule track with a translucent
 * fill, and a bar-shaped thumb that grows taut while dragging.
 *
 * Built on the same base-ui primitive the shared `Slider` wraps — pointer
 * capture, keyboard stepping, and ARIA all come from there — just restyled,
 * since opacity's 100 steps bury a dot thumb on a 6px rail. `data-dragging`
 * is the primitive's own drag state, so the grow-on-press needs no local
 * state or pointer handling of its own.
 */
export function OpacitySlider({
  value,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  'aria-label': string;
}) {
  return (
    <SliderPrimitive.Root
      aria-label={ariaLabel}
      min={0}
      max={1}
      step={0.01}
      value={value}
      thumbAlignment="edge"
      onValueChange={(next) => onValueChange(Array.isArray(next) ? next[0]! : next)}
    >
      <SliderPrimitive.Control className="relative flex h-4.5 w-full touch-none items-center overflow-hidden rounded-md bg-panel select-none">
        <SliderPrimitive.Track className="relative h-full w-full">
          <SliderPrimitive.Indicator className="absolute inset-y-0 left-0 h-full bg-fg/15" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          className={cn(
            'block h-3 w-1 rounded-sm bg-fg shadow-sm outline-none select-none',
            'ring-focus/50 focus-visible:ring-4',
            'transition-transform duration-fast ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none',
            'data-dragging:scale-y-[1.35]',
          )}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
