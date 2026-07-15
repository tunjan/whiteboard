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
        "flex w-full rounded-lg border border-border-subtle bg-bg-subtle p-0.5",
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
        "flex h-7 flex-1 cursor-pointer items-center justify-center rounded-md border border-transparent text-xs font-medium text-content-subtle transition-[color,background-color,border-color,box-shadow,transform] duration-150 ease-out select-none hover:text-content-emphasis data-[pressed]:border-border-subtle data-[pressed]:bg-bg-default data-[pressed]:text-content-emphasis data-[pressed]:shadow-hover [&_.lucide]:pointer-events-none [&_.lucide]:size-4 [&_.lucide]:shrink-0",
        className
      )}
      {...props}
    />
  )
}

export { ToggleGroup, ToggleGroupItem }
