import * as React from 'react';

import { cn } from '@/lib/utils';

/** Compact section label used inside chrome panels and dialogs ("Color", "Stroke size", "Appearance"…). */
function PanelLabel({
  className,
  as: Comp = 'span',
  ...props
}: React.ComponentProps<'span'> & { as?: React.ElementType }) {
  return (
    <Comp
      data-slot="panel-label"
      className={cn('type-overline block text-fg-muted select-none', className)}
      {...props}
    />
  );
}

export { PanelLabel };
