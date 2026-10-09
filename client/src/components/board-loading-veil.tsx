import { useEffect, useId, useRef, useState } from 'react';
import type { BoardLoadStage } from '@/board/board-readiness';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import {
  BRUSH_STROKES,
  BRUSH_VIEW_BOX,
} from '@/components/brush-stroke-geometry';
import { DOT_GRID_REST_PX, GROUND_FADE_MASK } from '@/canvas/grid';
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
 *
 * Nothing on the sheet is prose. The stage used to be spelled out under a
 * progress bar — "Restoring local copy", "Syncing board" — which names four
 * internals the reader cannot act on and would not recognise. The handshake's
 * shape is the better description of itself: three waits, drawn as three
 * brush strokes, one of them being laid down. What is done, what
 * is happening and what is left are all legible without a word, and the words still exist for a screen reader, which
 * cannot see the marks.
 */

/** The handoff, in three beats: the last stroke lands, the title and figure
 *  lift away, then the sheet dissolves. A 240ms cut read as the board simply
 *  replacing the loading screen; spread out, it reads as the one becoming the
 *  other. `SHEET_DELAY_MS + SHEET_FADE_MS` is when the sheet is gone. */
const SHEET_DELAY_MS = 250;
const SHEET_FADE_MS = 650;
const FADE_MS = SHEET_DELAY_MS + SHEET_FADE_MS;
/** A join served from cache is over before this, and a figure that appears for
 *  a tenth of a second reads as a glitch, not as progress. */
const CONTENT_DELAY_MS = 400;

/** How many of the three waits are behind us. `boardLoadStage` collapses the
 *  page settle and the page sync into one stage, so the machine exposes three
 *  waits, not the four flags `isBoardReady` reads. Three strokes, three
 *  waits: the figure would be lying if it painted a fourth. */
const STEPS_DONE: Record<BoardLoadStage, number> = {
  local: 0,
  remote: 1,
  page: 2,
  ready: 3,
};

const STEP_COUNT = 3;

/** The stroke in flight creeps toward, never reaches, its end:
 *  this much of it is left unpainted until its wait actually lands. One long
 *  decelerating transition rather than a loop, so a stalled join repaints one
 *  small SVG for the length of the creep and then nothing — no animation runs
 *  under the sheet for as long as the network takes. */
const IN_FLIGHT_LEFT = 0.3;
const CREEP = '9s cubic-bezier(0.15, 0.65, 0.3, 1)';
/** A wait landing finishes its stroke from wherever the creep had got to. */
const LAND = '650ms cubic-bezier(0.2, 0, 0, 1)';

/** Read aloud, never drawn. */
const STAGE_CAPTION: Record<BoardLoadStage, string> = {
  local: 'Restoring local copy',
  remote: 'Syncing board',
  page: 'Opening page',
  ready: 'Ready',
};

/** The board's own dot grid, at the board's own token and its own spacing
 *  (`DOT_GRID_REST_PX` in canvas/grid.ts). The sheet is paper before it is a
 *  loading screen, so what arrives first is the paper. Painted as a background
 *  rather than mounted from `Background.tsx` because that component needs a
 *  camera, and the camera behind the veil is not yet the one you will land on:
 *  a grid in the wrong phase would slide under the board at handoff. */
const GROUND: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at center, var(--grid-dot) 1px, transparent 1.5px)',
  backgroundSize: `${DOT_GRID_REST_PX}px ${DOT_GRID_REST_PX}px`,
  // Without this the field runs into the board's own chrome at the edges and
  // reads as a texture on the UI rather than as a sheet of paper under it.
  maskImage: GROUND_FADE_MASK,
  WebkitMaskImage: GROUND_FADE_MASK,
};

export function BoardLoadingVeil({ title }: { title: string }) {
  const ready = useBoardLoadingStore((s) => s.ready);
  const stage = useBoardLoadingStore((s) => s.stage);
  const [gone, setGone] = useState(false);
  const [showContent, setShowContent] = useState(false);

  // The figure only ever advances. Stage can strictly speaking be recomputed
  // downwards (a flag arriving out of order), and a mark that empties again is
  // worse than one that pauses.
  const furthest = useRef(0);
  const done = Math.max(furthest.current, STEPS_DONE[stage]);
  furthest.current = done;

  const clipId = useId();
  // Strokes hold empty until the figure is shown, so the first one is seen
  // being painted rather than arriving already most of the way across. Ready
  // arms them too: a cached join never shows the figure, and the static
  // markup should still say "done".
  const armed = showContent || ready;

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
        'absolute inset-0 z-[var(--z-veil)] flex touch-none items-center justify-center overscroll-none bg-canvas transition-opacity ease-in-out-quart',
        ready ? 'pointer-events-none opacity-0' : 'opacity-100',
      )}
      style={
        ready
          ? {
              transitionDuration: `${SHEET_FADE_MS}ms`,
              transitionDelay: `${SHEET_DELAY_MS}ms`,
            }
          : undefined
      }
    >
      {/* On ready the paper blooms a hair outward while the sheet fades, so it
          reads as lifting off the board rather than dimming over it. `scale`,
          not `transform`: the settle animation owns `transform`. */}
      <div
        aria-hidden="true"
        className={cn(
          'veil-ground absolute inset-0 transition-[scale] ease-out-quart motion-reduce:scale-100',
          ready ? 'scale-[1.1]' : 'scale-100',
        )}
        style={{ ...GROUND, transitionDuration: `${FADE_MS}ms` }}
      />

      <div
        className={cn(
          'relative flex w-full max-w-md flex-col gap-6 px-8 transition-[opacity,translate] ease-out-expo motion-reduce:translate-y-0',
          showContent && !ready ? 'opacity-100' : 'opacity-0',
          // Lifts away after the last stroke has had its beat to land.
          ready
            ? '-translate-y-4 delay-150 duration-[500ms]'
            : 'translate-y-0 duration-slow',
        )}
      >
        {/* Rendered even while empty so the name landing does not reflow the
            column under the reader. */}
        <h1 className="min-h-9 text-2xl leading-9 font-medium tracking-heading text-balance text-fg">
          {title}
        </h1>

        {/* Three waits, three brush strokes, each painted in the direction
            it was drawn: what is done is painted, what is in flight is being
            painted, what is left is its faint silhouette. The last stroke
            landing completes the figure, which is the only "done" the sheet
            says. */}
        <svg
          aria-hidden="true"
          viewBox={BRUSH_VIEW_BOX}
          className="block h-auto w-full overflow-visible"
        >
          {BRUSH_STROKES.map(({ outline, pass, passWidth }, i) => {
            const painting = i === done && armed && !ready;
            const target =
              armed && (i < done || ready) ? 0 : painting ? IN_FLIGHT_LEFT : 1;
            return (
              <g key={i}>
                <clipPath id={`${clipId}-${i}`}>
                  <path d={outline} clipRule="evenodd" />
                </clipPath>
                <path
                  d={outline}
                  fillRule="evenodd"
                  className="fill-fg opacity-[0.07]"
                />
                <path
                  d={pass}
                  clipPath={`url(#${clipId}-${i})`}
                  pathLength={1}
                  fill="none"
                  strokeWidth={passWidth}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="1 2"
                  data-painting={painting || undefined}
                  className="veil-brush-pass stroke-fg"
                  style={{
                    strokeDashoffset: target,
                    transition: `stroke-dashoffset ${painting ? CREEP : LAND}`,
                  }}
                />
              </g>
            );
          })}
        </svg>
      </div>

      <p className="sr-only">
        {ready
          ? STAGE_CAPTION.ready
          : `${STAGE_CAPTION[stage]}, step ${done + 1} of ${STEP_COUNT}`}
      </p>
    </div>
  );
}
