import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const surfaceVariants = cva(
  "border border-border-subtle bg-bg-default text-content-emphasis select-none",
  {
    variants: {
      shape: {
        panel:
          "rounded-xl [--surface-control-radius:var(--radius-lg)]",
        pill: "rounded-full [--surface-control-radius:9999px]",
      },
    },
    defaultVariants: {
      shape: "panel",
    },
  }
)

/**
 * Floating chrome surface: the quiet bordered panel used by every piece
 * of board chrome (toolbar, top bars, style panel).
 *
 * The surface also publishes the radius for its inset controls. That keeps
 * hover and focus backgrounds optically aligned with the parent without each
 * caller having to repeat a border-radius override.
 */
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
