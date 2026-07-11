import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Floating chrome surface: the quiet bordered panel used by every piece
 * of board chrome (toolbar, top bars, style panel).
 *
 * One definition for the chrome look: token background, token border, one card
 * radius, and no default shadow. Callers opt into elevation only for true
 * popovers/menus.
 */
function Surface({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="surface"
      className={cn(
        "rounded-xl border border-border-subtle bg-bg-default text-content-emphasis select-none",
        className
      )}
      {...props}
    />
  )
}

export { Surface }
