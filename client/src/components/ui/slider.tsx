import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * Single-value horizontal slider built on Base UI. Used for continuous controls
 * inside chrome panels (e.g. opacity). The filled portion is monochrome so it
 * reads as control state instead of decoration.
 */
function Slider({
  className,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex w-full touch-none items-center px-2 py-1.5 select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-bg-subtle">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-bg-inverted" />
          <SliderPrimitive.Thumb className="size-4 rounded-full border-2 border-bg-inverted bg-bg-default transition-transform duration-150 ease-out focus-visible:outline-none pointer-coarse:size-6" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
