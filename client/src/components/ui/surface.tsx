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
  'touch-targets [&_svg:not([data-slot=avatar-fallback]_svg)]:stroke-[1.75]';

/**
 * Chrome that stays out of the way until it is wanted: invisible at rest,
 * present on hover, and permanently there for touch (`touch-reveal`) and for
 * anyone tabbing into it. Stated once because the call panel and the toolbar
 * both hang their secondary controls on it, and a restated rule is how two
 * surfaces drift apart. The host names its group `chrome`.
 *
 * Only for controls that sit *on* something — a video frame, a slab — where a
 * permanent glyph would be clutter. Never for the only control on a surface.
 */
export const HOVER_REVEAL =
  'touch-reveal opacity-0 transition-opacity duration-base ease-out-quart group-hover/chrome:opacity-100 group-focus-within/chrome:opacity-100';

/**
 * Chrome laid straight on the board: no fill, no border, and no shadow of its
 * own — a shadow cast by a box with nothing in it draws the outline of the
 * card that was removed. What separates these controls from the drawing under
 * them is on each control instead: the `tb-glyph` halo, and a translucent wash
 * on hover rather than the opaque chip a ghost control takes on a panel.
 *
 * Used by the canvas toolbar, the properties pill, and the two corner HUDs, so
 * every piece of chrome over the board disappears by the same rule.
 */
export const CHROME_ON_BOARD =
  'border-0 bg-transparent shadow-none [--chrome-hover:var(--color-tb-track)]';

/** A key inside one: round, and haloed because nothing is under it. */
export const CHROME_KEY_ON_BOARD = 'tb-glyph rounded-full';

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
