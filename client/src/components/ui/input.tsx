import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-control-border bg-surface px-2 py-1 text-sm text-fg transition-[border-color,box-shadow] duration-100 ease-out file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg placeholder:text-fg-subtle hover:border-fg-muted focus:border-focus focus:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:border-border disabled:bg-panel disabled:text-fg-subtle aria-invalid:border-danger-control-border',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
