import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "ui-button ui-interactive group/button bg-clip-padding in-data-[slot=surface]:rounded-[var(--surface-control-radius)]",
  {
    variants: {
      variant: {
        default: "ui-button-default",
        outline: "ui-button-outline",
        secondary: "ui-button-secondary",
        ghost: "ui-button-ghost",
        accent: "ui-button-accent",
        destructive: "ui-button-destructive",
        "danger-outline": "ui-button-danger-outline",
        link: "ui-button-link",
      },
      size: {
        default: "ui-button-md",
        xs: "ui-button-xs",
        sm: "ui-button-sm",
        lg: "ui-button-lg",
        icon: "ui-button-icon",
        "icon-xs": "ui-button-icon-xs",
        "icon-sm": "ui-button-icon-sm",
        "icon-lg": "ui-button-icon-lg",
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
