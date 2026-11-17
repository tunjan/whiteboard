import { create } from 'zustand';
import { genId, type DrawPoint, type Point } from '@whiteboard/shared';
import { setLocalEraserScribbles } from '@/collab/presence';

/** How long a swept point stays on the ribbon before the tail reaches it. */
export const ERASER_TRAIL_LIFE_MS = 150;
/** Longest the ribbon gets in screen pixels: a flick is a comet, not a bar. */
export const ERASER_TRAIL_MAX_LENGTH = 180;
/** Closer samples than this, in screen pixels, add nothing the ribbon can show. */
const MIN_SAMPLE_STEP = 2;
/**
 * Full width in screen pixels: the eraser's collision diameter, so a ribbon at
 * speed shows exactly what the swipe takes.
 */
export const ERASER_TRAIL_SIZE = 16;
export const ERASER_TRAIL_OPACITY = 0.5;

export interface EraserPoint extends DrawPoint {
  /** When the pointer was here, on the `performance.now()` clock. */
  t?: number;
}

export interface EraserScribble {
  id: string;
  /** World-space samples, oldest first. */
  points: EraserPoint[];
  state: 'active' | 'stopping';
  color: 'muted-1';
  /** Full diameter in screen pixels, before the ribbon's length scales it. */
  size: number;
  opacity: number;
  taper: true;
  /** When the pointer let go. */
  stoppedAt?: number;
}

interface EraserTrailStore {
  /** Usually one active scribble, plus any just-released ribbons draining out. */
  scribbles: EraserScribble[];
  activeId: string | null;
  begin: (p: Point, pressure?: number, time?: number) => void;
  extend: (p: Point, pressure?: number, time?: number, zoom?: number) => void;
  /**
   * Bring every ribbon up to `now`: tails advance through their expired
   * samples and released ribbons narrow. Only the clock decides how far, so it
   * reads the same at any refresh rate or pointer rate.
   */
  tick: (now: number, zoom: number) => void;
  /** Stop accepting points and let the active trail shrink away. */
  end: () => void;
  /** Immediate teardown for document/session disposal and deterministic tests. */
  clear: () => void;
}

function sample(
  p: Point,
  pressure = 0.5,
  t = performance.now(),
): EraserPoint {
  const normalized = Number.isFinite(pressure)
    ? Math.max(0, Math.min(1, pressure))
    : 0.5;
  return { x: p.x, y: p.y, pressure: normalized, t };
}

/**
 * Advance the tail to whichever comes first, walking back from the tip: the
 * point `cutoff` milliseconds old, or `maxLength` of travel. The tail lands
 * between samples rather than on them, so it glides however sparse the input.
 * Returns `points` itself when nothing was trimmed.
 */
function trimTail(
  points: EraserPoint[],
  cutoff: number,
  maxLength: number,
): EraserPoint[] {
  let remaining = maxLength;
  for (let i = points.length - 1; i > 0; i--) {
    const head = points[i]!;
    const tail = points[i - 1]!;
    const span = Math.hypot(head.x - tail.x, head.y - tail.y);
    const headTime = head.t ?? 0;
    const tailTime = tail.t ?? 0;
    let keep = span > remaining ? remaining / span : 1;
    if (tailTime < cutoff) {
      keep = Math.min(
        keep,
        headTime > tailTime ? (headTime - cutoff) / (headTime - tailTime) : 0,
      );
    }
    if (keep <= 0) return points.slice(i);
    if (keep < 1) {
      const fade = (from: number, to: number) => to + (from - to) * keep;
      return [
        {
          x: fade(tail.x, head.x),
          y: fade(tail.y, head.y),
          pressure: fade(tail.pressure ?? 0.5, head.pressure ?? 0.5),
          t: fade(tailTime, headTime),
        },
        ...points.slice(i),
      ];
    }
    remaining -= span;
  }
  return points;
}

function prefersReducedMotion(): boolean {
  return (
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function publish(scribbles: EraserScribble[]): void {
  // Peers get only a serialized snapshot, over the collab socket's stateless
  // channel. The source of truth remains this local session store and never
  // enters the shared document/undo history.
  setLocalEraserScribbles(scribbles);
}

/**
 * Session-scoped eraser scribbles.
 *
 * A ribbon is the last {@link ERASER_TRAIL_LIFE_MS} of the pointer's travel, so
 * its length is the hand's speed: a slow rub is a short nub, a swipe a long
 * comet, and a held tip collapses to the dot it started from. Releasing moves
 * it to `stopping`, where the same tail catches up while the width eases to
 * nothing. Every snapshot is relayed to collaborators so they can render the
 * gesture; the pending-deletion set travels separately via the eraser store.
 */
export const useEraserTrailStore = create<EraserTrailStore>((set, get) => ({
  scribbles: [],
  activeId: null,

  begin: (p, pressure, time) => {
    const { scribbles } = get();
    // A new press may arrive before the previous release has drained. Preserve
    // that old trail as a stopping ribbon instead of popping it off screen.
    const stopping = scribbles.map((scribble) =>
      scribble.state === 'active'
        ? { ...scribble, state: 'stopping' as const, stoppedAt: time }
        : scribble,
    );
    const id = genId();
    const next = [
      ...stopping,
      {
        id,
        points: [sample(p, pressure, time)],
        state: 'active' as const,
        color: 'muted-1' as const,
        size: ERASER_TRAIL_SIZE,
        opacity: ERASER_TRAIL_OPACITY,
        taper: true as const,
      },
    ];
    set({ scribbles: next, activeId: id });
    publish(next);
  },

  extend: (p, pressure, time, zoom = 1) => {
    const { activeId, scribbles } = get();
    if (!activeId) return;
    let changed = false;
    const next = scribbles.map((scribble) => {
      if (scribble.id !== activeId || scribble.state !== 'active')
        return scribble;
      const last = scribble.points[scribble.points.length - 1];
      if (last && last.x === p.x && last.y === p.y) return scribble;
      const before = scribble.points[scribble.points.length - 2];
      // The tip has to land exactly under the pointer, so a sample too close
      // to keep slides the tip along instead of being dropped.
      const crowded =
        before &&
        Math.hypot(p.x - before.x, p.y - before.y) * zoom < MIN_SAMPLE_STEP;
      const points = crowded
        ? scribble.points.slice(0, -1)
        : scribble.points.slice();
      points.push(sample(p, pressure, time));
      changed = true;
      return { ...scribble, points };
    });
    if (!changed) return;
    set({ scribbles: next });
    publish(next);
  },

  tick: (now, zoom) => {
    const { scribbles } = get();
    const cutoff = now - ERASER_TRAIL_LIFE_MS;
    const maxLength = ERASER_TRAIL_MAX_LENGTH / Math.max(zoom, 0.05);
    let changed = false;
    const next: EraserScribble[] = [];
    for (const scribble of scribbles) {
      const points = trimTail(scribble.points, cutoff, maxLength);
      if (scribble.state === 'active') {
        changed ||= points !== scribble.points;
        next.push(
          points === scribble.points ? scribble : { ...scribble, points },
        );
        continue;
      }

      changed = true;
      const progress =
        Math.max(0, now - (scribble.stoppedAt ?? now)) / ERASER_TRAIL_LIFE_MS;
      if (progress >= 1 || prefersReducedMotion()) continue;
      // Holds its width while the tail retracts, then lets go at the end.
      next.push({
        ...scribble,
        points,
        size: ERASER_TRAIL_SIZE * (1 - progress * progress),
      });
    }
    if (!changed) return;
    set({ scribbles: next });
    publish(next);
  },

  end: () => {
    const { activeId, scribbles } = get();
    if (!activeId) return;
    const next = scribbles.map((scribble) =>
      scribble.id === activeId
        ? {
            ...scribble,
            state: 'stopping' as const,
            stoppedAt: performance.now(),
          }
        : scribble,
    );
    set({ scribbles: next, activeId: null });
    publish(next);
  },

  clear: () => {
    const { scribbles, activeId } = get();
    if (scribbles.length === 0 && activeId === null) return;
    set({ scribbles: [], activeId: null });
    publish([]);
  },
}));
