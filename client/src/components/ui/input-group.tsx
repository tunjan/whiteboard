import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      className={cn(
        "relative flex items-center w-full rounded-lg border border-input bg-transparent transition-colors outline-none focus-within:ring-2 focus-within:ring-foreground focus-within:ring-offset-2 disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
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
        "h-8 w-full min-w-0 bg-transparent px-2.5 py-1 text-base placeholder:text-muted-foreground outline-none border-0 focus:outline-none focus:ring-0 focus-visible:ring-0 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:cursor-not-allowed md:text-sm flex-1",
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
        "flex items-center shrink-0 px-2 text-muted-foreground select-none",
        className
      )}
      {...props}
    />
  )
}

export { InputGroup, InputGroupInput, InputGroupAddon }
