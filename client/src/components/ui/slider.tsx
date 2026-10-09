import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn } from '@/lib/utils';

/**
 * A capsule fader: a pill track the height of a small control, with the filled
 * range running under an inset pill thumb that shrinks under the pointer.
 *
 * Three custom properties drive the geometry so the parts stay in step. The
 * thumb's *layout* box is the pill plus `--wb-slider-pad` on every side, which
 * buys two things at once:
 *
 *  - `thumbAlignment="edge"` keeps that box inside the track, so the pill holds
 *    its padding at both ends of the travel instead of touching the cap.
 *  - Base UI ends the indicator at the centre of the thumb box, so adding
 *    exactly half that box brings the fill to the far side of the pill plus its
 *    padding — and at the maximum it lands flush with the end of the track.
 *    That is the `box-content` padding on the indicator; percentage widths
 *    can't express it on their own.
 *
 * The press shrink sits on an inner element rather than the thumb itself:
 * Base UI measures the thumb with `getBoundingClientRect`, which sees
 * transforms, so scaling the thumb would shift the value-to-position mapping
 * mid-drag and make the thumb jump near the ends.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: SliderPrimitive.Root.Props) {
  // How many thumbs to render. Base UI takes a single value as a bare number,
  // and every slider in this app is a single value, so falling back to
  // `[min, max]` drew a second thumb pinned to the maximum on all of them —
  // and that stray thumb is the one that ends up on top at the right-hand end
  // of the track, so grabbing it there did nothing.
  const _values =
    value !== undefined
      ? toValues(value)
      : defaultValue !== undefined
        ? toValues(defaultValue)
        : [min, max];

  return (
    <SliderPrimitive.Root
      className={cn(
        '[--wb-slider-pad:0.125rem] [--wb-slider-thumb:1.5rem] [--wb-slider-track:1.25rem]',
        'data-horizontal:w-full data-vertical:h-full',
        className,
      )}
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow rounded-full bg-panel select-none data-horizontal:h-(--wb-slider-track) data-horizontal:w-full data-vertical:h-full data-vertical:w-(--wb-slider-track)"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className={cn(
              'box-content rounded-full bg-check select-none',
              'data-horizontal:h-full data-horizontal:pe-[calc(var(--wb-slider-thumb)/2+var(--wb-slider-pad))]',
              'data-vertical:w-full data-vertical:pb-[calc(var(--wb-slider-thumb)/2+var(--wb-slider-pad))]',
            )}
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={cn(
              'group/thumb relative block rounded-full ring-focus/50 select-none has-[:focus-visible]:ring-4',
              'data-horizontal:h-(--wb-slider-track) data-horizontal:w-[calc(var(--wb-slider-thumb)+2*var(--wb-slider-pad))]',
              'data-vertical:h-[calc(var(--wb-slider-thumb)+2*var(--wb-slider-pad))] data-vertical:w-(--wb-slider-track)',
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-(--wb-slider-pad) rounded-full bg-surface shadow-xs',
                'transition-transform duration-instant ease-out-quart motion-reduce:transition-none',
                'group-data-dragging/thumb:scale-[0.88]',
              )}
            />
          </SliderPrimitive.Thumb>
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

function toValues(value: number | readonly number[]): readonly number[] {
  return Array.isArray(value) ? value : [value as number];
}

export { Slider };
