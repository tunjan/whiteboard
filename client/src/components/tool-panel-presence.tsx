import { useEffect, useRef, useState, type ReactElement } from 'react';

const CLOSE_DURATION_FALLBACK_MS = 220;

function cssDurationToMs(value: string): number {
  const duration = value.trim();
  const parsed = Number.parseFloat(duration);
  if (!Number.isFinite(parsed)) return CLOSE_DURATION_FALLBACK_MS;
  if (duration.endsWith('ms')) {
    return parsed;
  }
  if (duration.endsWith('s')) {
    return parsed * 1000;
  }
  return CLOSE_DURATION_FALLBACK_MS;
}

/**
 * Keeps a contextual tool panel mounted for its close transition, while
 * caching the last visible contents so tool changes do not flash a partial
 * panel on the way out.
 */
export function ToolPanelPresence({
  visible,
  children,
}: {
  visible: boolean;
  children: ReactElement | null;
}) {
  const lastVisibleChild = useRef<ReactElement | null>(children);
  const panelRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(visible);
  const hasOpenedRef = useRef(false);
  const [mounted, setMountedState] = useState(visible);
  const [phase, setPhase] = useState<'entering' | 'open' | 'closing'>(
    visible ? 'entering' : 'closing',
  );

  if (visible && children) {
    lastVisibleChild.current = children;
  }

  useEffect(() => {
    let frame = 0;
    let closeTimer = 0;

    const setMounted = (next: boolean) => {
      mountedRef.current = next;
      setMountedState(next);
    };

    if (visible) {
      if (!mountedRef.current) {
        setMounted(true);
        hasOpenedRef.current = false;
        setPhase('entering');
      }

      if (hasOpenedRef.current) {
        setPhase('open');
      } else {
        frame = requestAnimationFrame(() => {
          hasOpenedRef.current = true;
          setPhase('open');
        });
      }
    } else if (mountedRef.current) {
      setPhase('closing');

      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setMounted(false);
        hasOpenedRef.current = false;
      } else {
        const closeDuration = panelRef.current
          ? cssDurationToMs(
              getComputedStyle(panelRef.current).getPropertyValue(
                '--panel-close-dur',
              ),
            )
          : CLOSE_DURATION_FALLBACK_MS;

        closeTimer = window.setTimeout(() => {
          setMounted(false);
          hasOpenedRef.current = false;
        }, closeDuration + 40);
      }
    }

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(closeTimer);
    };
  }, [visible]);

  if (!mounted || !lastVisibleChild.current) return null;

  // Sits one 1rem gutter below the docked top-right chrome, and the same 1rem
  // in from the right edge, so the float reads as deliberate rather than as a
  // panel that failed to dock.
  //
  // The chrome cluster is 2.75rem tall (p-1.5 + a 2rem control row) and hangs
  // off the safe-area inset. On >=sm it starts at the very top, so it ends at
  // 2.75rem → panel top 3.75rem. Below sm it is pushed down to 2.75rem to clear
  // the board-nav panel, so it ends at 5.5rem → panel top 6.5rem.
  return (
    <div
      ref={panelRef}
      data-open={phase === 'open'}
      data-phase={phase}
      aria-hidden={!visible}
      inert={!visible}
      className="t-panel-slide tool-panel-presence absolute top-[calc(6.5rem+env(safe-area-inset-top))] right-[calc(1rem+env(safe-area-inset-right))] sm:top-[calc(3.75rem+env(safe-area-inset-top))]"
    >
      {lastVisibleChild.current}
    </div>
  );
}
