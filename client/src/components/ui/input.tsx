import * as React from 'react';
import { Input as InputPrimitive } from '@base-ui/react/input';

import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        'h-10 w-full min-w-0 rounded-control border border-control-border bg-surface px-3 py-2 text-base text-fg transition-colors duration-instant file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-base file:font-medium file:text-fg placeholder:text-fg-subtle hover:border-fg-muted focus:border-action disabled:pointer-events-none disabled:border-border disabled:bg-panel disabled:text-fg-subtle aria-invalid:border-danger-control-border',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
