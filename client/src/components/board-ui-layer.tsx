import { useRef, type ReactNode } from 'react';
import { usePassThroughWheelEvents } from '@/canvas/use-pass-through-wheel';

/**
 * The click-through plane that holds every floating board panel — chrome,
 * toolbar, style/graph/equation panels, the audio banner.
 *
 * It exists for three reasons the panels cannot cover individually:
 *  - it is the single stacking band that sits above the canvas, so panels stop
 *    competing on ad-hoc z-index values and order by intent (see section 7 of
 *    `index.css`);
 *  - it covers the whole board without blocking it, since `.wb-ui-layer` drops
 *    pointer events and re-enables them per panel;
 *  - one wheel listener here forwards to the canvas for every panel inside it,
 *    rather than each panel wiring up its own.
 *
 * `data-ui-layer` marks the subtree as chrome for the canvas's hit-testing and
 * hover-cursor checks, matching the in-canvas floating UI.
 */
export function BoardUiLayer({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  usePassThroughWheelEvents(ref);

  return (
    <div ref={ref} data-ui-layer className="wb-ui-layer z-[var(--z-ui)]">
      {children}
    </div>
  );
}
