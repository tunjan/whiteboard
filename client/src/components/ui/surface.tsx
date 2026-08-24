import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

/**
 * Conventions every chrome control follows, wherever it is rendered: coarse
 * pointers get 44px hit areas, and icons draw at the 1.5 hairline weight
 * rather than lucide's default 2.
 *
 * Exported because the session controls also render outside a chrome Surface —
 * in the compact "Session tools" popover — and must look identical there.
 * Restating the rule at that call site is how the two drifted apart.
 */
export const CHROME_CONTROLS =
  'touch-targets [&_svg:not([data-slot=avatar-fallback]_svg)]:stroke-[1.5]';

const surfaceVariants = cva(
  'select-none rounded-panel border border-border bg-surface text-fg',
  {
    variants: {
      shape: {
        panel: 'rounded-panel',
        pill: 'rounded-full',
      },
      mode: {
        // `--chrome-hover` is the fill a ghost control takes on hover. It has
        // to be one step away from the surface it sits on, and the two modes
        // sit on different surfaces: a floating panel is `surface`, so its
        // controls darken to `panel`; a docked panel already *is* `panel`, so
        // its controls have to go the other way, up to `surface`.
        floating: 'shadow-panel [--chrome-hover:var(--color-panel)]',
        docked: 'bg-panel shadow-none [--chrome-hover:var(--color-surface)]',
      },
      chrome: {
        true: CHROME_CONTROLS,
        false: '',
      },
    },
    defaultVariants: {
      shape: 'panel',
      mode: 'floating',
      chrome: false,
    },
  },
);

/** Shared surface. Board chrome opts into compact geometry with `chrome`. */
function Surface({
  className,
  shape = 'panel',
  mode = 'floating',
  chrome = false,
  ...props
}: React.ComponentProps<'div'> & VariantProps<typeof surfaceVariants>) {
  return (
    <div
      data-slot="surface"
      data-shape={shape}
      data-mode={mode}
      className={cn(surfaceVariants({ shape, mode, chrome }), className)}
      {...props}
    />
  );
}

export { Surface, surfaceVariants };
