import * as React from "react"
import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { toggleVariants } from "@/components/ui/toggle"

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants> & {
    orientation?: "horizontal" | "vertical"
  }
>({
  size: "default",
  variant: "default",
  orientation: "horizontal",
})

function ToggleGroup({
  className,
  variant,
  size,
  orientation = "horizontal",
  children,
  multiple,
  ...props
}: ToggleGroupPrimitive.Props &
  VariantProps<typeof toggleVariants> & {
    orientation?: "horizontal" | "vertical"
  }) {
  const rootRef = React.useRef<HTMLDivElement>(null)
  const plateRef = React.useRef<HTMLSpanElement>(null)

  // The plate glides to the pressed item. Base UI's ToggleGroup has no
  // indicator, so measure it after each render and on resize.
  const place = React.useCallback(() => {
    const root = rootRef.current
    const plate = plateRef.current
    if (!root || !plate) return
    const item = root.querySelector<HTMLElement>(':scope > [aria-pressed="true"]')
    if (!item) {
      plate.style.opacity = "0"
      return
    }
    plate.style.opacity = "1"
    plate.style.left = `${item.offsetLeft}px`
    plate.style.top = `${item.offsetTop}px`
    plate.style.width = `${item.offsetWidth}px`
    plate.style.height = `${item.offsetHeight}px`
  }, [])

  React.useLayoutEffect(place)

  React.useEffect(() => {
    const root = rootRef.current
    if (!root || multiple) return
    const observer = new ResizeObserver(place)
    observer.observe(root)
    return () => observer.disconnect()
  }, [multiple, place])

  return (
    <ToggleGroupPrimitive
      ref={rootRef}
      multiple={multiple}
      data-slot="toggle-group"
      data-multiple={multiple ? "" : undefined}
      data-variant={variant}
      data-size={size}
      data-orientation={orientation}
      className={cn(
        "group/toggle-group relative flex w-fit flex-row items-center rounded-[11px] bg-[color-mix(in_srgb,var(--bg-panel),var(--bg-sunken))] p-[3px] data-vertical:flex-col data-vertical:items-stretch",
        className
      )}
      {...props}
    >
      {!multiple && (
        <span
          ref={plateRef}
          aria-hidden
          className="pointer-events-none absolute z-0 rounded-control bg-surface opacity-0 shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] transition-[left,top,width,height] duration-200 ease-[cubic-bezier(0.2,0,0,1)] dark:bg-[#404040]"
        />
      )}
      <ToggleGroupContext.Provider
        value={{ variant, size, orientation }}
      >
        {children}
      </ToggleGroupContext.Provider>
    </ToggleGroupPrimitive>
  )
}

function ToggleGroupItem({
  className,
  children,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  const context = React.useContext(ToggleGroupContext)

  return (
    <TogglePrimitive
      data-slot="toggle-group-item"
      data-variant={context.variant || variant}
      data-size={context.size || size}
      className={cn(
        // After toggleVariants: tailwind-merge keeps the last of a conflict,
        // and the plate must show through the pressed item.
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        "relative z-10 shrink-0 text-fg-secondary transition-[color,scale] duration-150 ease-out hover:bg-transparent active:scale-[0.96] aria-pressed:bg-transparent aria-pressed:text-fg group-data-multiple/toggle-group:aria-pressed:bg-surface group-data-multiple/toggle-group:aria-pressed:shadow-[0_0_0_1px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.06)] dark:group-data-multiple/toggle-group:aria-pressed:bg-[#404040]",
        className
      )}
      {...props}
    >
      {children}
    </TogglePrimitive>
  )
}

export { ToggleGroup, ToggleGroupItem }
