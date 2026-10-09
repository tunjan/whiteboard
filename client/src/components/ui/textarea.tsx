import * as React from 'react';

import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-control-border bg-surface px-3 py-2 text-sm text-fg transition-[border-color,box-shadow] duration-100 ease-out placeholder:text-fg-subtle hover:border-fg-muted focus:border-focus focus:shadow-focus focus-visible:outline-none disabled:pointer-events-none disabled:border-border disabled:bg-panel disabled:text-fg-subtle aria-invalid:border-danger-control-border',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
