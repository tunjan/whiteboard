import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "ui-field-control ui-textarea flex field-sizing-content text-base md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
