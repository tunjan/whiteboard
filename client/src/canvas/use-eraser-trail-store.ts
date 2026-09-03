import { create } from 'zustand';
import { genId, type DrawPoint, type Point } from '@whiteboard/shared';
import { setLocalEraserScribbles } from '@/collab/presence';

/** Longest an active trail ever gets. Older samples are eaten from the tail. */
export const ERASER_TRAIL_MAX = 8;
/** Visual width in screen pixels. Collision size is intentionally independent. */
export const ERASER_TRAIL_SIZE = 12;
export const ERASER_TRAIL_OPACITY = 0.8;
export const ERASER_TRAIL_SHRINK = 0.1;

export interface EraserScribble {
  id: string;
  /** World-space samples, oldest first. */
  points: DrawPoint[];
  state: 'active' | 'stopping';
  color: 'muted-1';
  /** Current diameter in screen pixels. */
  size: number;
  opacity: number;
  shrink: number;
  taper: true;
}

interface EraserTrailStore {
  /** Usually one active scribble, plus any just-released ribbons draining out. */
  scribbles: EraserScribble[];
  activeId: string | null;
  /** Bumped only by pointer input, so the animation tick can detect an idle tip. */
  seq: number;
  begin: (p: Point, pressure?: number) => void;
  extend: (p: Point, pressure?: number) => void;
  /**
   * Advance the self-consuming queue by one animation frame. Stopping trails
   * always drain; the active trail drains only when `consumeActive` is true.
   */
  tick: (consumeActive: boolean) => void;
  /** Stop accepting points and let the active trail shrink away. */
  end: () => void;
  /** Immediate teardown for document/session disposal and deterministic tests. */
  clear: () => void;
}

function sample(p: Point, pressure = 0.5): DrawPoint {
  const normalized = Number.isFinite(pressure)
    ? Math.max(0, Math.min(1, pressure))
    : 0.5;
  return { x: p.x, y: p.y, pressure: normalized };
}

function publish(scribbles: EraserScribble[]): void {
  // Awareness owns only the serialized snapshot. The source of truth remains
  // this local session store and never enters the shared document/undo history.
  setLocalEraserScribbles(scribbles);
}

/**
 * Session-scoped eraser scribbles.
 *
 * Each active ribbon is capped at eight points. When input pauses, animation
 * frames shift its oldest point until only the tip remains. Releasing the
 * pointer moves the ribbon to `stopping`; subsequent frames keep shifting the
 * tail while shrinking its diameter by ten percent, then remove it. Every
 * snapshot is mirrored through awareness so collaborators can render the
 * gesture without receiving the local pending-deletion set.
 */
export const useEraserTrailStore = create<EraserTrailStore>((set, get) => ({
  scribbles: [],
  activeId: null,
  seq: 0,

  begin: (p, pressure) => {
    const { scribbles, seq } = get();
    // A new press may arrive before the previous release has drained. Preserve
    // that old trail as a stopping ribbon instead of popping it off screen.
    const stopping = scribbles.map((scribble) =>
      scribble.state === 'active'
        ? { ...scribble, state: 'stopping' as const }
        : scribble,
    );
    const id = genId();
    const next = [
      ...stopping,
      {
        id,
        points: [sample(p, pressure)],
        state: 'active' as const,
        color: 'muted-1' as const,
        size: ERASER_TRAIL_SIZE,
        opacity: ERASER_TRAIL_OPACITY,
        shrink: ERASER_TRAIL_SHRINK,
        taper: true as const,
      },
    ];
    set({ scribbles: next, activeId: id, seq: seq + 1 });
    publish(next);
  },

  extend: (p, pressure) => {
    const { activeId, scribbles, seq } = get();
    if (!activeId) return;
    let changed = false;
    const next = scribbles.map((scribble) => {
      if (scribble.id !== activeId || scribble.state !== 'active')
        return scribble;
      const last = scribble.points[scribble.points.length - 1];
      if (last && last.x === p.x && last.y === p.y) return scribble;
      const points =
        scribble.points.length >= ERASER_TRAIL_MAX
          ? scribble.points.slice(1)
          : scribble.points.slice();
      points.push(sample(p, pressure));
      changed = true;
      return { ...scribble, points };
    });
    if (!changed) return;
    set({ scribbles: next, seq: seq + 1 });
    publish(next);
  },

  tick: (consumeActive) => {
    const { activeId, scribbles } = get();
    let changed = false;
    const next: EraserScribble[] = [];
    for (const scribble of scribbles) {
      if (scribble.id === activeId && scribble.state === 'active') {
        if (consumeActive && scribble.points.length > 1) {
          next.push({ ...scribble, points: scribble.points.slice(1) });
          changed = true;
        } else {
          next.push(scribble);
        }
        continue;
      }

      // A stopped two-point ribbon becomes a one-point dot after this shift;
      // remove it in the same frame so no inert session survives indefinitely.
      const points = scribble.points.slice(1);
      if (points.length <= 1) {
        changed = true;
        continue;
      }
      next.push({
        ...scribble,
        points,
        size: Math.max(1, scribble.size * (1 - scribble.shrink)),
      });
      changed = true;
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
        ? { ...scribble, state: 'stopping' as const }
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
