import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Small uppercase section label used inside chrome panels and dialogs
 * ("Color", "Stroke size", "Appearance"…).
 *
 * Encodes the one metadata-label treatment so section headings don't drift in
 * size or letter-spacing across panels. Renders a block-level span by default;
 * pass `render` semantics via `className` only — keep it a label, not a heading,
 * unless the surrounding context needs heading order (dialogs pass `asChild`).
 */
function PanelLabel({
  className,
  as: Comp = "span",
  ...props
}: React.ComponentProps<"span"> & { as?: React.ElementType }) {
  return (
    <Comp
      data-slot="panel-label"
      className={cn(
        "block text-[11px] leading-4 font-semibold tracking-wide text-content-muted uppercase select-none",
        className
      )}
      {...props}
    />
  )
}

export { PanelLabel }
