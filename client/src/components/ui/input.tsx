import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "ui-field-control ui-input in-data-[slot=surface]:rounded-[var(--surface-control-radius)] file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-content-emphasis",
        className
      )}
      {...props}
    />
  )
}

export { Input }
