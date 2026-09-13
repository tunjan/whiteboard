import { useEffect, useRef, useState } from 'react';
import {
  type BoardLoadStage,
  boardLoadProgress,
} from '@/board/board-readiness';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { cn } from '@/lib/utils';

/**
 * The sheet over a board that has not finished joining.
 *
 * Joining takes four round trips that the old UI made visible one by one: an
 * empty canvas, a page swapping under you, then shapes arriving. This holds the
 * board back until it is correct, and everything behind it — the canvas, the
 * chrome, the title resolving from its placeholder — settles unwatched.
 *
 * It covers `.wb-board` only. The two things that used to shout over a joining
 * board, the latency warning and the name prompt, are portaled to the body and
 * could never be covered from in here; they are gated on the same readiness
 * signal at their own source instead.
 */

/** Matches the `duration-slow` fade below. */
const FADE_MS = 240;
/** A join served from cache is over before this, and a figure that appears for
 *  a tenth of a second reads as a glitch, not as progress. */
const CONTENT_DELAY_MS = 400;

const STAGE_CAPTION: Record<BoardLoadStage, string> = {
  local: 'Restoring local copy',
  remote: 'Syncing board',
  page: 'Opening page',
  ready: 'Ready',
};

export function BoardLoadingVeil({ title }: { title: string }) {
  const ready = useBoardLoadingStore((s) => s.ready);
  const stage = useBoardLoadingStore((s) => s.stage);
  const [gone, setGone] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // The rule only ever advances. Stage can strictly speaking be recomputed
  // downwards (a flag arriving out of order), and a progress bar that slides
  // back is worse than one that pauses.
  const furthest = useRef(0);
  const progress = Math.max(furthest.current, boardLoadProgress(stage));
  furthest.current = progress;

  useEffect(() => {
    const timer = setTimeout(() => setShowContent(true), CONTENT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Unmount on a timer rather than `transitionend`: that event never fires if
  // the browser skips the transition, which would leave the sheet up for good.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setGone(true), FADE_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (gone) return null;

  return (
    <div
      role="status"
      aria-busy={!ready}
      className={cn(
        // `touch-none overscroll-none` because an opaque sheet still lets a
        // pinch or a swipe through to the canvas underneath otherwise.
        'absolute inset-0 z-[var(--z-veil)] flex touch-none items-center justify-center overscroll-none bg-canvas transition-opacity duration-slow ease-out-quart',
        ready ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
    >
      <div
        className={cn(
          'flex w-full max-w-md flex-col gap-5 px-8 transition-[opacity,scale] duration-slow ease-out-expo motion-reduce:scale-100',
          showContent ? 'opacity-100' : 'opacity-0',
          ready ? 'scale-[1.01]' : 'scale-100',
        )}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 32 32"
          fill="none"
          aria-hidden="true"
          className="text-fg-subtle"
        >
          <rect
            className="veil-mark"
            x="4.5"
            y="4.5"
            width="23"
            height="23"
            stroke="currentColor"
            strokeWidth="1.25"
          />
        </svg>

        {/* Rendered even while empty so the name landing does not reflow the
            column under the reader. */}
        <h1 className="min-h-8 text-2xl leading-8 font-medium tracking-tight text-balance text-fg">
          {title}
        </h1>

        <div className="h-px w-full overflow-hidden bg-border-subtle">
          <div
            className="h-full w-full origin-left bg-fg transition-transform duration-slower ease-out-expo"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>

        <p className="text-2xs tracking-wide text-fg-subtle uppercase">
          {STAGE_CAPTION[stage]}
        </p>
      </div>
    </div>
  );
}
