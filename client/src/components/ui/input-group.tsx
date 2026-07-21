import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "ui-field-shell relative flex w-full items-center",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input-group-input"
      className={cn(
        "h-8 w-full min-w-0 flex-1 border-0 bg-transparent px-2.5 py-1 text-sm placeholder:text-content-muted outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 disabled:pointer-events-none disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  )
}

function InputGroupAddon({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group-addon"
      className={cn(
        "flex shrink-0 items-center px-2 text-content-subtle select-none",
        className
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupInput, InputGroupAddon }
