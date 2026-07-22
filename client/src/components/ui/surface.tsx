import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const surfaceVariants = cva(
  "select-none rounded-xl bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10",
  {
    variants: {
      shape: {
        panel: "",
        pill: "rounded-full",
      },
    },
    defaultVariants: {
      shape: "panel",
    },
  }
)

/** Floating chrome surface used by board chrome (toolbar, top bars, style panel). */
function Surface({
  className,
  shape = "panel",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof surfaceVariants>) {
  return (
    <div
      data-slot="surface"
      data-shape={shape}
      className={cn(surfaceVariants({ shape }), className)}
      {...props}
    />
  )
}

export { Surface, surfaceVariants }
