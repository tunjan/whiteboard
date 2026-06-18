import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * Single-value horizontal slider built on Base UI. Used for continuous controls
 * inside chrome panels (e.g. opacity). The filled portion uses the single brand
 * accent so it stays consistent with selection and primary actions; the thumb is
 * a hollow ring that reads on any track color.
 */
function Slider({
  className,
  ...props
}: SliderPrimitive.Root.Props<number>) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="flex w-full touch-none items-center py-1.5 select-none">
        <SliderPrimitive.Track className="relative h-1.5 w-full rounded-full bg-muted">
          <SliderPrimitive.Indicator className="absolute h-full rounded-full bg-accent-brand" />
          <SliderPrimitive.Thumb className="size-4 rounded-full border-2 border-accent-brand bg-background shadow-sm transition-transform hover:scale-110 focus-visible:outline-none pointer-coarse:size-6" />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
