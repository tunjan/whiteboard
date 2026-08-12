import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // No press-scale: a control that squashes under the cursor reads as soft.
  // The colour transition is the press feedback, and it keeps every edge in
  // the chrome on its pixel.
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent font-medium whitespace-nowrap transition-colors duration-instant ease-out-quart select-none disabled:pointer-events-none disabled:bg-panel disabled:text-fg-subtle [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-inverse text-fg-inverse hover:bg-inverse-hover shadow-e1",
        primary:
          "bg-inverse text-fg-inverse hover:bg-inverse-hover shadow-e1",
        outline:
          "border-border bg-surface text-fg hover:bg-surface-hover hover:border-border-strong shadow-e1",
        secondary:
          "border-border bg-surface text-fg hover:bg-surface-hover hover:border-border-strong shadow-e1",
        subtle:
          "bg-panel text-fg hover:bg-surface-hover",
        // Hover resolves against whatever surface the button sits on. A fixed
        // `bg-panel` hover is invisible on the docked chrome panels, which are
        // themselves `bg-panel` — every control in the four corner panels had
        // no hover response at all. Surfaces that aren't panel-coloured set
        // `--chrome-hover`; everything else keeps the panel fallback.
        //
        // A variant with no resting fill must also not grow one when disabled,
        // or a greyed-out chrome button paints a chip the enabled one never
        // had and the row loses its rhythm.
        ghost:
          "bg-transparent text-fg-secondary hover:bg-[var(--chrome-hover,var(--color-panel))] hover:text-fg disabled:bg-transparent",
        destructive:
          "border-danger-border bg-surface text-danger-fg hover:bg-danger-bg shadow-e1",
        link: "text-fg underline-offset-4 hover:underline disabled:bg-transparent",
      },
      size: {
        default:
          "h-10 gap-2 px-4 text-base rounded-lg",
        xs: "h-6 gap-1 rounded-sm px-2 text-2xs [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 text-sm [&>svg:not([class*='size-']):not([data-native-size])]:size-3.5",
        md: "h-10 gap-2 rounded-lg px-4 text-base [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        lg: "h-12 gap-2 rounded-xl px-5 text-md [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        icon: "size-10 rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        "icon-xs":
          "size-6 rounded-sm [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        "icon-sm":
          "size-8 rounded-md [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        "icon-md":
          "size-10 rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        "icon-lg": "size-12 rounded-xl [&>svg:not([class*='size-']):not([data-native-size])]:size-5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
