import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "@/lib/utils"

/**
 * Single-value horizontal slider built on Base UI. Used for continuous controls
 * inside chrome panels (e.g. opacity). The filled portion is monochrome so it
 * reads as control state instead of decoration.
 *
 * `aria-label` is forwarded to the Thumb: Base UI renders the real
 * `<input type="range">` there, so a label left on the Root would never reach
 * the element assistive tech actually announces.
 */
function Slider({
  className,
  "aria-label": ariaLabel,
  valueText,
  ...props
}: SliderPrimitive.Root.Props<number> & { valueText?: string }) {
  return (
    <SliderPrimitive.Root data-slot="slider" className={cn("w-full", className)} {...props}>
      <SliderPrimitive.Control className="ui-slider-control">
        <SliderPrimitive.Track className="ui-slider-track">
          <SliderPrimitive.Indicator className="ui-slider-indicator" />
          <SliderPrimitive.Thumb
            className="ui-slider-thumb"
            aria-label={ariaLabel}
            aria-valuetext={valueText}
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
