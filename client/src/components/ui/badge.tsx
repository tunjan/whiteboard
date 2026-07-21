import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "ui-badge group/badge has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
  {
    variants: {
      variant: {
        default: "ui-badge-default",
        secondary: "ui-badge-secondary",
        destructive: "ui-badge-destructive",
        outline: "ui-badge-outline",
        ghost: "ui-badge-ghost",
        link: "ui-badge-link",
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
