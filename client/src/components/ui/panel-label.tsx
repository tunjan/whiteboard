import * as React from "react"

import { cn } from "@/lib/utils"

/** Compact section label used inside chrome panels and dialogs ("Color", "Stroke size", "Appearance"…). */
function PanelLabel({
  className,
  as: Comp = "span",
  ...props
}: React.ComponentProps<"span"> & { as?: React.ElementType }) {
  return (
    <Comp
      data-slot="panel-label"
      className={cn("block text-xs font-medium text-muted-foreground select-none", className)}
      {...props}
    />
  )
}

export { PanelLabel }
