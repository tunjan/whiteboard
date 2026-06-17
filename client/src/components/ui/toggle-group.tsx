import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { cn } from "@/lib/utils"

function ToggleGroup<Value extends string = string>({
  className,
  ...props
}: ToggleGroupPrimitive.Props<Value>) {
  return (
    <ToggleGroupPrimitive
      data-slot="toggle-group"
      className={cn(
        "flex rounded-lg border border-border p-0.5 bg-muted/50 w-full",
        className
      )}
      {...props}
    />
  )
}

function ToggleGroupItem({
  className,
  ...props
}: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      className={cn(
        "flex-1 flex h-7 items-center justify-center rounded-md text-xs font-medium transition-colors border border-transparent text-muted-foreground hover:text-foreground data-[pressed]:bg-card data-[pressed]:text-foreground data-[pressed]:shadow-sm data-[pressed]:border-border/50 dark:data-[pressed]:border-white/10 cursor-pointer select-none",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
