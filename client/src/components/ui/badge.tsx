import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border border-transparent px-2.5 text-xs font-medium whitespace-nowrap transition-colors duration-instant [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-panel text-fg-secondary border-border",
        secondary: "bg-panel text-fg border-border",
        destructive: "bg-danger-bg text-danger-fg border-danger-border",
        danger: "bg-danger-bg text-danger-fg border-danger-border",
        success: "bg-success-bg text-success-fg border-success-border",
        warning: "bg-warning-bg text-warning-fg border-warning-border",
        info: "bg-info-bg text-info-fg border-info-border",
        inactive: "bg-inactive-bg text-inactive-fg border-inactive-border",
        neutral: "bg-neutral-bg text-neutral-fg border-neutral-border",
        outline: "border-border bg-transparent text-fg-secondary",
        ghost: "hover:bg-panel hover:text-fg",
        link: "text-fg underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
