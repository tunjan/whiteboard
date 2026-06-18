import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Floating chrome surface: the translucent, blurred panel used by every piece
 * of board chrome (toolbar, top bars, style panel).
 *
 * One definition for the glass look — background, border, blur, shadow, and
 * radius all come from tokens (`--panel`, `--panel-border`) so the chrome stays
 * consistent and adapts to the theme. Callers supply layout (position, size,
 * padding) via `className`.
 */
function Surface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="surface"
      className={cn(
        "rounded-xl border border-panel-border bg-panel shadow-premium select-none",
        "supports-[backdrop-filter]:backdrop-blur-md dark:shadow-black/40",
        className
      )}
      {...props}
    />
  )
}

export { Surface }
