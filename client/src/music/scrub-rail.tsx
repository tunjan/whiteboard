import { Slider as SliderPrimitive } from '@base-ui/react/slider';

import { cn } from '@/lib/utils';

/**
 * The track position.
 *
 * The panel holds two continuous values and they are not the same kind of
 * thing: position is the room's — dragging it moves everyone — and volume is
 * yours alone. When both were drawn as the same capsule fader there was
 * nothing in the panel that said so, and the only way to find out was to move
 * one and watch what happened to the other person.
 *
 * So position is a different instrument, not a differently-coloured one: a
 * hairline that reports where the track is, and that thickens into something
 * you can grab when the pointer or the focus ring arrives. At rest it is state;
 * on intent it is a control. The fill stays the same accent the app's other
 * sliders use, because the difference being drawn here is shape, not hue.
 */
export function ScrubRail({
  className,
  ...props
}: Omit<SliderPrimitive.Root.Props, 'thumbAlignment'>) {
  return (
    <SliderPrimitive.Root
      data-slot="scrub-rail"
      // Centre alignment: the thumb's middle *is* the value, so the fill ends
      // exactly under it with no padding arithmetic. The half-thumb overhang at
      // either cap is the normal shape of a scrub rail.
      thumbAlignment="center"
      className={cn('w-full', className)}
      {...props}
    >
      <SliderPrimitive.Control className="group/rail relative flex h-4 w-full touch-none items-center select-none data-disabled:pointer-events-none data-disabled:opacity-50">
        <SliderPrimitive.Track
          data-slot="scrub-rail-track"
          className={cn(
            'relative h-[3px] w-full grow rounded-full bg-sunken select-none',
            'transition-[height] duration-instant ease-out-quart motion-reduce:transition-none',
            'group-hover/rail:h-[6px] data-dragging:h-[6px] group-has-[:focus-visible]/rail:h-[6px]',
          )}
        >
          <SliderPrimitive.Indicator
            data-slot="scrub-rail-range"
            className="absolute h-full rounded-full bg-check select-none"
          />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb
          data-slot="scrub-rail-thumb"
          className={cn(
            'block size-2.5 rounded-full bg-check ring-focus/50 select-none',
            'scale-0 transition-transform duration-instant ease-out-quart motion-reduce:transition-none',
            'group-hover/rail:scale-100 data-dragging:scale-100',
            'has-[:focus-visible]:scale-100 has-[:focus-visible]:ring-4',
          )}
        />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}
