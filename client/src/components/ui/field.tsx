import * as React from "react"
import {
  Field,
  type FieldRootProps,
  type FieldLabelProps,
  type FieldDescriptionProps,
  type FieldErrorProps,
  type FieldControlProps,
} from "@base-ui/react/field"
import { cn } from "@/lib/utils"

const FieldContext = React.createContext<{
  orientation?: "horizontal" | "vertical"
}>({ orientation: "vertical" })

function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

interface FieldProps extends FieldRootProps {
  orientation?: "horizontal" | "vertical"
}

function CustomField({
  className,
  orientation = "vertical",
  ...props
}: FieldProps) {
  return (
    <FieldContext.Provider value={{ orientation }}>
      <Field.Root
        data-slot="field"
        className={cn(
          "group/field flex",
          orientation === "horizontal"
            ? "flex-row items-center justify-between gap-4"
            : "flex-col gap-1.5",
          className
        )}
        {...props}
      />
    </FieldContext.Provider>
  )
}

function FieldLabel({
  className,
  ...props
}: FieldLabelProps) {
  return (
    <Field.Label
      data-slot="field-label"
      className={cn(
        "text-sm font-medium leading-none text-foreground select-none group-data-[disabled]/field:opacity-50 group-data-[invalid]/field:text-destructive shrink-0",
        className
      )}
      {...props}
    />
  )
}

function FieldDescription({
  className,
  ...props
}: FieldDescriptionProps) {
  return (
    <Field.Description
      data-slot="field-description"
      className={cn(
        "text-xs text-muted-foreground group-data-[disabled]/field:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function FieldError({
  className,
  ...props
}: FieldErrorProps) {
  return (
    <Field.Error
      data-slot="field-error"
      className={cn(
        "text-xs font-medium text-destructive",
        className
      )}
      {...props}
    />
  )
}

function FieldControl({ ...props }: FieldControlProps) {
  return <Field.Control data-slot="field-control" {...props} />
}

export {
  CustomField as Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldError,
  FieldControl,
}
