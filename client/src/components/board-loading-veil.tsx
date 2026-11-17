import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { BoardLoadStage } from '@/board/board-readiness';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { underline, underlineSeed } from '@/components/brush-stroke-geometry';
import { DrawingCursor } from '@/canvas/DrawingCursor';
import { DOT_GRID_REST_PX, GROUND_FADE_MASK } from '@/canvas/grid';
import { inkPaint } from '@/canvas/ink-color';
import { useStyleStore } from '@/canvas/use-style-store';
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
 * internals the reader cannot act on and would not recognise. Instead the
 * board's title is underlined by hand while you wait: one brush stroke, the
 * way a tutor marks the heading before the lesson starts, its length the
 * progress and its closing flick the "done". The words still exist for a
 * screen reader, which cannot see the mark.
 */

/** The handoff, in three beats: the underline flicks off, the title and it
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
 *  waits, not the four flags `isBoardReady` reads. The underline's run is cut
 *  in thirds to match. */
const STEPS_DONE: Record<BoardLoadStage, number> = {
  local: 0,
  remote: 1,
  page: 2,
  ready: 3,
};

const STEP_COUNT = 3;

/** The brush works through each wait's third of the run but stops short of
 *  its end until the wait actually lands — a hand pausing mid-line, not a bar
 *  that lies about being nearly there. One long decelerating transition per
 *  wait rather than a loop, so a stalled join repaints one small SVG for the
 *  length of the creep and then nothing. Its steep start is also the pen
 *  picking up speed again when the next wait begins. */
const IN_FLIGHT = 0.7;
const CREEP = '9s cubic-bezier(0.15, 0.65, 0.3, 1)';
/** The rest of the run and the flick, in one motion that speeds up into the
 *  lift: a brush leaves the paper moving, never by coasting to a stop. */
const FINISH = '520ms cubic-bezier(0.45, 0, 0.8, 0.55)';
/** What the underline is drawn under while the title is still a placeholder,
 *  so the first beat of the stroke is not wasted waiting for a name. */
const PLACEHOLDER_WIDTH = 120;
/** From the bottom of the title's line box to the underline's spine. The
 *  line box already carries the descenders' room. */
const UNDERLINE_GAP = 7;

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

/** The same lattice under the pointer, its dots grown and inked darker: the
 *  paper notices the hand before the hand does anything. A cross-fade through
 *  a soft mask rather than a true per-dot size falloff, which would mean
 *  painting the grid by hand; at this radius the eye reads it as swelling. */
const LENS: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at center, color-mix(in srgb, var(--grid-dot-ink) 70%, transparent) 1.75px, transparent 2.25px)',
  backgroundSize: GROUND.backgroundSize,
  maskImage:
    'radial-gradient(circle 130px at var(--lens-x, -999px) var(--lens-y, -999px), black 25%, transparent)',
  WebkitMaskImage:
    'radial-gradient(circle 130px at var(--lens-x, -999px) var(--lens-y, -999px), black 25%, transparent)',
};

/** How long a doodle on the sheet lasts. Long enough to see the letter you
 *  wrote, short enough that the sheet is clean again before you look up. */
const INK_LIFE_MS = 1100;
const INK_WIDTH = 3;

type InkPoint = { x: number; y: number; w: number; t: number };

/**
 * Something to do with your hands while the board joins: the sheet takes ink,
 * and the ink evaporates. Each point thins out from the moment it is laid, so
 * a stroke lifts off tail first, the way the laser does on the board — the
 * sheet stays a loading screen, not a second canvas that forgets.
 *
 * Opaque throughout and thinned rather than faded: a translucent tail beads at
 * every segment joint where round caps overlap.
 *
 * Drawn in the pen's own colour and under the pen's own cursor, so the first
 * mark on the board is made with a tool the hand has already been holding.
 * The loop runs only while there is ink left; an untouched sheet costs
 * nothing.
 */
function SheetInk() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const color = useStyleStore((s) => s.color);
  const strokes = useRef<InkPoint[][]>([]);
  const drawing = useRef(false);
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const paint = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const now = performance.now();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    strokes.current = strokes.current
      .map((s) => s.filter((p) => now - p.t < INK_LIFE_MS))
      .filter((s, i, all) => s.length > 0 || (drawing.current && i === all.length - 1));

    for (const s of strokes.current) {
      for (let i = 1; i < s.length; i++) {
        // Midpoint quadratics, so a fast flick is a curve, not a polygon.
        const a = s[i - 2] ?? s[i - 1]!;
        const b = s[i - 1]!;
        const c = s[i]!;
        const life = 1 - (now - c.t) / INK_LIFE_MS;
        ctx.lineWidth = c.w * life;
        ctx.beginPath();
        ctx.moveTo((a.x + b.x) / 2, (a.y + b.y) / 2);
        ctx.quadraticCurveTo(b.x, b.y, (b.x + c.x) / 2, (b.y + c.y) / 2);
        ctx.stroke();
      }
      // A tap is a dot, not nothing.
      if (s.length === 1) {
        const p = s[0]!;
        const life = 1 - (now - p.t) / INK_LIFE_MS;
        ctx.beginPath();
        ctx.arc(p.x, p.y, (p.w * life) / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    frame.current =
      strokes.current.length > 0 ? requestAnimationFrame(paint) : 0;
  };

  const add = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const stroke = strokes.current.at(-1);
    if (!stroke) return;
    // Every sample the device produced, not one per frame: a quick loop
    // drawn at 60 events a second comes out as a polygon otherwise.
    for (const ev of e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent]) {
      const pressure = ev.pointerType === 'pen' ? 0.4 + ev.pressure * 1.2 : 1;
      stroke.push({
        x: ev.clientX - rect.left,
        y: ev.clientY - rect.top,
        w: INK_WIDTH * pressure,
        t: performance.now(),
      });
    }
    if (!frame.current) frame.current = requestAnimationFrame(paint);
  };

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 size-full"
      style={{ color: inkPaint(color) }}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const canvas = e.currentTarget;
        // Sized per gesture rather than observed: the sheet only resizes
        // with the window, and a stale size would only blur, never misplace.
        const dpr = window.devicePixelRatio || 1;
        const w = Math.round(canvas.clientWidth * dpr);
        const h = Math.round(canvas.clientHeight * dpr);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext('2d');
        // `var(--ink)` means nothing to a 2D context; the computed colour does.
        if (ctx) ctx.strokeStyle = ctx.fillStyle = getComputedStyle(canvas).color;
        canvas.setPointerCapture(e.pointerId);
        drawing.current = true;
        strokes.current.push([]);
        add(e);
      }}
      onPointerMove={(e) => {
        if (drawing.current) add(e);
      }}
      onPointerUp={() => (drawing.current = false)}
      onPointerCancel={() => (drawing.current = false)}
    />
  );
}

export function BoardLoadingVeil({ title }: { title: string }) {
  const ready = useBoardLoadingStore((s) => s.ready);
  const stage = useBoardLoadingStore((s) => s.stage);
  const [gone, setGone] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const [showContent, setShowContent] = useState(false);

  // The figure only ever advances. Stage can strictly speaking be recomputed
  // downwards (a flag arriving out of order), and a mark that empties again is
  // worse than one that pauses.
  const furthest = useRef(0);
  const done = Math.max(furthest.current, STEPS_DONE[stage]);
  furthest.current = done;

  const clipId = useId();
  // The stroke holds empty until the figure is shown, so it is seen being
  // laid down rather than arriving already most of the way across. Ready arms
  // it too: a cached join never shows the figure, and the static markup
  // should still say "done".
  const armed = showContent || ready;

  // The underline is cut to the title's inked width, not its box: a balanced
  // title wraps short of the column, and a line running past the words reads
  // as a rule, not as underlining.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [span, setSpan] = useState({
    left: -PLACEHOLDER_WIDTH / 2,
    width: PLACEHOLDER_WIDTH,
  });
  useLayoutEffect(() => {
    const h1 = titleRef.current;
    if (!h1) return;
    const measure = () => {
      const range = document.createRange();
      range.selectNodeContents(h1);
      const text = range.getBoundingClientRect();
      const box = h1.getBoundingClientRect();
      setSpan(
        text.width > 0
          ? {
              left: Math.round(text.left - box.left),
              width: Math.round(text.width),
            }
          : {
              left: Math.round((box.width - PLACEHOLDER_WIDTH) / 2),
              width: PLACEHOLDER_WIDTH,
            },
      );
    };
    measure();
    // Catches the web font landing, which changes the width under a title
    // that did not change.
    const observer = new ResizeObserver(measure);
    observer.observe(h1);
    return () => observer.disconnect();
  }, [title]);
  const stroke = useMemo(
    () => underline(span.width, underlineSeed(title)),
    [span.width, title],
  );
  const vb = stroke.viewBox;
  const reached = ready
    ? 1
    : armed
      ? stroke.inkStart +
        ((done + IN_FLIGHT) / STEP_COUNT) * (stroke.runEnd - stroke.inkStart)
      : 0;

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

  // Written straight to the lens, never through state: a re-render per
  // pointer move would cost more than the lens is worth.
  const moveLens = (e: React.PointerEvent) => {
    const lens = lensRef.current;
    if (!lens) return;
    if (e.pointerType === 'touch') {
      lens.style.opacity = '0';
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    lens.style.setProperty('--lens-x', `${e.clientX - rect.left}px`);
    lens.style.setProperty('--lens-y', `${e.clientY - rect.top}px`);
    lens.style.opacity = '1';
  };

  return (
    <div
      ref={sheetRef}
      role="status"
      aria-busy={!ready}
      onPointerMove={moveLens}
      onPointerLeave={() => {
        if (lensRef.current) lensRef.current.style.opacity = '0';
      }}
      className={cn(
        // `touch-none overscroll-none` because an opaque sheet still lets a
        // pinch or a swipe through to the canvas underneath otherwise.
        // `select-none` because a doodle that starts on the title would
        // otherwise highlight it; `cursor-none` because the pencil below is
        // the cursor.
        'absolute inset-0 z-[var(--z-veil)] flex cursor-none touch-none items-center justify-center overscroll-none bg-canvas transition-opacity ease-in-out-quart select-none',
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
      >
        {/* Inside the ground so it shares its scale, and so its mask: the
            lens fades out toward the edges with the paper it sits on. */}
        <div
          ref={lensRef}
          className="absolute inset-0 opacity-0 transition-opacity duration-slow ease-out-quart"
          style={LENS}
        />
      </div>

      <div
        className={cn(
          // Lifted to the optical centre, where the ground's own fade is
          // centred (45%, `GROUND_FADE_MASK`): a figure at the true centre of
          // a sheet reads as having slipped below it.
          'relative mb-[10vh] flex w-full max-w-md flex-col items-center px-8 transition-[opacity,translate] ease-out-expo motion-reduce:translate-y-0',
          showContent && !ready ? 'opacity-100' : 'opacity-0',
          // Lifts away once the flick has had its beat to land.
          ready
            ? '-translate-y-4 delay-150 duration-[500ms]'
            : 'translate-y-0 duration-slow',
        )}
      >
        <div className="relative w-fit max-w-full">
          {/* Rendered even while empty so the name landing does not reflow
              the column under the reader. */}
          <h1
            ref={titleRef}
            className="min-h-9 text-center text-2xl leading-9 font-medium tracking-heading text-balance text-fg"
          >
            {title}
          </h1>

          {/* Out of flow, so its overshoot past the words does not widen
              the title's box and pull the title off centre. */}
          <svg
            aria-hidden="true"
            viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.height}`}
            width={vb.width}
            height={vb.height}
            className="absolute top-full overflow-visible"
            style={{ left: span.left + vb.x, marginTop: UNDERLINE_GAP + vb.y }}
          >
            <clipPath id={clipId}>
              <path d={stroke.outline} clipRule="evenodd" />
            </clipPath>
            <path
              d={stroke.pass}
              clipPath={`url(#${clipId})`}
              pathLength={1}
              fill="none"
              strokeWidth={stroke.passWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray="1 2"
              className="veil-underline stroke-fg"
              style={{
                strokeDashoffset: 1 - reached,
                transition: `stroke-dashoffset ${ready ? FINISH : CREEP}`,
              }}
            />
          </svg>
        </div>
      </div>

      <SheetInk />
      <DrawingCursor containerRef={sheetRef} />

      <p className="sr-only">
        {ready
          ? STAGE_CAPTION.ready
          : `${STAGE_CAPTION[stage]}, step ${done + 1} of ${STEP_COUNT}`}
      </p>
    </div>
  );
}
