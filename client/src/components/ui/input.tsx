import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-md border border-border-subtle bg-bg-default px-3 py-2 text-sm text-content-emphasis transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-content-emphasis placeholder:text-content-muted focus-visible:border-border-emphasis focus-visible:ring-4 focus-visible:ring-border-subtle disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-content-muted disabled:opacity-100 aria-invalid:border-content-error aria-invalid:ring-4 aria-invalid:ring-bg-error",
        className
      )}
      {...props}
    />
  )
}

export { Input }
