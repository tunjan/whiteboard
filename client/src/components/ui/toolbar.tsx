"use client"

import { Toolbar as ToolbarPrimitive } from "@base-ui/react/toolbar"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

function Toolbar({ className, ...props }: ToolbarPrimitive.Root.Props) {
  return (
    <ToolbarPrimitive.Root
      data-slot="toolbar"
      className={cn(
        "group/toolbar flex w-fit items-center gap-1 rounded-toolbar border border-border bg-surface p-1 shadow-toolbar data-vertical:flex-col contrast-more:border-fg-secondary forced-colors:border-[CanvasText] forced-colors:bg-[Canvas]",
        className
      )}
      {...props}
    />
  )
}

function ToolbarGroup({ className, ...props }: ToolbarPrimitive.Group.Props) {
  return (
    <ToolbarPrimitive.Group
      data-slot="toolbar-group"
      className={cn(
        "flex items-center gap-0.5 group-data-vertical/toolbar:flex-col",
        className
      )}
      {...props}
    />
  )
}

function ToolbarSeparator({
  className,
  ...props
}: ToolbarPrimitive.Separator.Props) {
  return (
    <ToolbarPrimitive.Separator
      data-slot="toolbar-separator"
      className={cn(
        "shrink-0 bg-tb-divider data-horizontal:mx-auto data-horizontal:my-1 data-horizontal:h-px data-horizontal:w-1/2 data-vertical:mx-1 data-vertical:h-5 data-vertical:w-px forced-colors:bg-[CanvasText]",
        className
      )}
      {...props}
    />
  )
}

const toolbarButtonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center rounded-control text-fg-secondary transition-colors select-none hover:bg-tb-track hover:text-fg active:bg-tb-chip aria-expanded:bg-tb-chip aria-expanded:text-fg aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg aria-pressed:hover:bg-tb-sel-bg-hover aria-pressed:hover:text-tb-sel-fg data-disabled:pointer-events-none data-disabled:opacity-50 motion-reduce:transition-none contrast-more:aria-pressed:bg-action contrast-more:aria-pressed:text-on-action forced-colors:aria-pressed:bg-[Highlight] forced-colors:aria-pressed:text-[HighlightText] [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      size: {
        default: "size-9",
        sm: "size-8 [&_svg:not([class*='size-'])]:size-4",
        lg: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      size: "default",
    },
  }
)

function ToolbarButton({
  className,
  size = "default",
  ...props
}: ToolbarPrimitive.Button.Props & VariantProps<typeof toolbarButtonVariants>) {
  return (
    <ToolbarPrimitive.Button
      data-slot="toolbar-button"
      data-size={size}
      className={cn(toolbarButtonVariants({ size, className }))}
      {...props}
    />
  )
}

export {
  Toolbar,
  ToolbarButton,
  ToolbarGroup,
  ToolbarSeparator,
  toolbarButtonVariants,
}
