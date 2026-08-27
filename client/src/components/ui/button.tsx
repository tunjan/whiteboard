import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center border border-transparent bg-clip-padding font-medium whitespace-nowrap transition-all select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        primary: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-surface text-fg hover:bg-surface-hover hover:border-border-strong shadow-e1",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        subtle:
          "bg-panel text-fg hover:bg-surface-hover",
        ghost:
          "bg-transparent text-fg-secondary hover:bg-[var(--chrome-hover,var(--color-panel))] hover:text-fg disabled:bg-transparent",
        destructive:
          "border-danger-border bg-surface text-danger-fg hover:bg-danger-bg shadow-e1",
        link: "text-fg underline-offset-4 hover:underline disabled:bg-transparent",
      },
      size: {
        default:
          "h-10 gap-2 px-4 text-base rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        md:
          "h-10 gap-2 px-4 text-base rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        xs:
          "h-6 gap-1 rounded-sm px-2 text-2xs [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        sm:
          "h-8 gap-1.5 rounded-md px-3 text-sm [&>svg:not([class*='size-']):not([data-native-size])]:size-3.5",
        lg:
          "h-12 gap-2 rounded-xl px-5 text-md [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        icon:
          "size-10 rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        "icon-xs":
          "size-6 rounded-sm [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        "icon-sm":
          "size-8 rounded-md [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        "icon-md":
          "size-10 rounded-lg [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        "icon-lg":
          "size-12 rounded-xl [&>svg:not([class*='size-']):not([data-native-size])]:size-5",
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
