import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all duration-150 ease-out outline-none select-none in-data-[slot=surface]:rounded-[var(--surface-control-radius)] focus-visible:ring-4 focus-visible:ring-border-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-bg-subtle disabled:text-content-muted disabled:opacity-100 disabled:shadow-none aria-invalid:border-content-error aria-invalid:ring-4 aria-invalid:ring-bg-error [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "border-bg-inverted bg-bg-inverted text-content-inverted hover:ring-4 hover:ring-border-subtle",
        outline:
          "border-border-subtle bg-bg-default text-content-emphasis hover:border-border-emphasis hover:bg-bg-muted hover:text-content-emphasis hover:ring-4 hover:ring-border-subtle aria-expanded:border-border-emphasis aria-expanded:bg-bg-muted aria-expanded:text-content-emphasis",
        secondary:
          "border-border-subtle bg-bg-default text-content-emphasis hover:border-border-emphasis hover:bg-bg-muted hover:ring-4 hover:ring-border-subtle aria-expanded:border-border-emphasis aria-expanded:bg-bg-muted aria-expanded:text-content-emphasis",
        ghost:
          "text-content-default hover:bg-[var(--neutral-wash)] hover:text-content-emphasis aria-expanded:bg-[var(--neutral-wash)] aria-expanded:text-content-emphasis",
        accent:
          "border-[var(--accent-blue)] bg-[var(--accent-blue)] text-content-inverted hover:bg-content-info hover:ring-4 hover:ring-bg-info focus-visible:ring-bg-info",
        destructive:
          "border-content-error bg-content-error text-content-inverted hover:ring-4 hover:ring-bg-error focus-visible:ring-bg-error",
        "danger-outline":
          "border-transparent bg-bg-default text-content-error hover:bg-content-error hover:text-content-inverted hover:ring-4 hover:ring-bg-error focus-visible:ring-bg-error",
        link: "text-content-emphasis underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-10 gap-2 px-3 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-2.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-4 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10",
        "icon-xs":
          "size-7 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-md in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
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
