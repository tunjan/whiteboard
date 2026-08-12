import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-16 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-fg transition-colors duration-instant placeholder:text-fg-subtle hover:border-border-strong focus:border-border-strong disabled:pointer-events-none disabled:bg-panel disabled:text-fg-subtle aria-invalid:border-danger-border aria-invalid:ring-2 aria-invalid:ring-danger-border/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
