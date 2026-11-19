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
 * An instrument: a cluster of controls that floats over the board. The
 * material is `.wb-instrument` and the resting state is `.wb-chrome-quiet`
 * (both section 8 of `index.css`); this is the layout that goes on them.
 *
 * Quiet is the point. An instrument sits on a wash until you reach for it and
 * takes its plate on hover, on focus, while a menu it opened is standing, or
 * while it holds something that is running. An edge on this board still means
 * "you can press this" — it just stops claiming it at a distance, which is
 * what let four corners outweigh the drawing between them.
 */
export const INSTRUMENT =
  // Keys inside take the plate's 12px less its 4px padding.
  'wb-instrument wb-chrome-quiet flex items-center gap-0.5 p-1 [--radius-control:var(--radius-lg)]';

/**
 * A key inside one. No halo: a halo is what separates a glyph from a drawing
 * when nothing is under it, and here the plate already does that — a halo on
 * top of a plate is a smear around the glyph.
 */
export const INSTRUMENT_KEY =
  'rounded-control [--chrome-hover:var(--color-tb-track)]';

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
