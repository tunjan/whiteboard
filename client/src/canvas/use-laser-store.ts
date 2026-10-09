import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';
import { setLocalLaser } from '@/collab/presence';

export interface LaserStroke {
  id: string;
  /** Polyline in world coordinates. */
  points: Point[];
  /** Set when the hold expires; the stroke then fades out and is removed. */
  done: boolean;
}

/**
 * How long finished strokes stay fully visible after the pointer lifts. Drawing
 * again restarts the wait, so a multi-stroke annotation stays up as long as the
 * presenter keeps going and only clears once they pause.
 */
export const LASER_HOLD_MS = 1000;
/** How long the fade-out itself takes, once it starts. */
export const LASER_FADE_MS = 900;

interface LaserStore {
  strokes: LaserStroke[];
  begin: (id: string, point: Point) => void;
  extend: (id: string, point: Point) => void;
  /** The gesture is over: hold what is drawn, then fade it once idle. */
  end: () => void;
  /** Start fading every held stroke. Called when the idle hold expires. */
  fadeAll: () => void;
  /** Drop a stroke immediately (aborted gesture, or fade complete). */
  discard: (id: string) => void;
}

const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Shared across strokes: the hold is about the pointer going idle, not one stroke. */
let holdTimer: ReturnType<typeof setTimeout> | null = null;

function clearHold(): void {
  if (holdTimer === null) return;
  clearTimeout(holdTimer);
  holdTimer = null;
}

/**
 * Local, transient laser-pointer strokes. Not part of the CRDT — strokes reach
 * peers as stateless messages (setLocalLaser sends what changed) and evaporate on
 * their own: pointer-up starts an idle hold, the hold expiring marks strokes
 * done, LaserLayer animates the fade, and removal timers drop them for good.
 */
export const useLaserStore = create<LaserStore>((set, get) => ({
  strokes: [],
  begin: (id, point) => {
    // Drawing again re-arms the hold; strokes already fading keep fading out.
    clearHold();
    set({ strokes: [...get().strokes, { id, points: [point], done: false }] });
    setLocalLaser(get().strokes);
  },
  extend: (id, point) => {
    set({
      strokes: get().strokes.map((s) =>
        s.id === id ? { ...s, points: [...s.points, point] } : s,
      ),
    });
    setLocalLaser(get().strokes);
  },
  end: () => {
    // The stroke stays as it is — only going idle for LASER_HOLD_MS fades it.
    clearHold();
    holdTimer = setTimeout(() => {
      holdTimer = null;
      get().fadeAll();
    }, LASER_HOLD_MS);
  },
  fadeAll: () => {
    const held = get().strokes.filter((s) => !s.done);
    if (held.length === 0) return;
    set({
      strokes: get().strokes.map((s) => (s.done ? s : { ...s, done: true })),
    });
    setLocalLaser(get().strokes);
    // Per-stroke removal timers: a stroke drawn while an earlier batch is still
    // fading must not be swept up by that batch's removal.
    for (const stroke of held) {
      removalTimers.set(
        stroke.id,
        setTimeout(() => get().discard(stroke.id), LASER_FADE_MS),
      );
    }
  },
  discard: (id) => {
    const timer = removalTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    removalTimers.delete(id);
    set({ strokes: get().strokes.filter((s) => s.id !== id) });
    setLocalLaser(get().strokes);
  },
}));
