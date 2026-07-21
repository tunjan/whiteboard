import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';
import { setLocalLaser } from '@/collab/presence';

export interface LaserStroke {
  id: string;
  /** Polyline in world coordinates. */
  points: Point[];
  /** Set when the pointer lifts; the stroke then fades out and is removed. */
  done: boolean;
}

/** How long a finished stroke stays visible while fading out. */
export const LASER_FADE_MS = 600;

interface LaserStore {
  strokes: LaserStroke[];
  begin: (id: string, point: Point) => void;
  extend: (id: string, point: Point) => void;
  /** Finish a stroke: it fades in place and is removed after LASER_FADE_MS. */
  end: (id: string) => void;
  /** Drop a stroke immediately (aborted gesture, or fade complete). */
  discard: (id: string) => void;
}

const removalTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Local, transient laser-pointer strokes. Not part of the CRDT — strokes reach
 * peers through awareness (setLocalLaser mirrors every change) and evaporate on
 * their own: pointer-up marks a stroke done, LaserLayer animates the fade, and
 * a removal timer drops it for good.
 */
export const useLaserStore = create<LaserStore>((set, get) => ({
  strokes: [],
  begin: (id, point) => {
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
  end: (id) => {
    set({
      strokes: get().strokes.map((s) =>
        s.id === id ? { ...s, done: true } : s,
      ),
    });
    setLocalLaser(get().strokes);
    removalTimers.set(
      id,
      setTimeout(() => get().discard(id), LASER_FADE_MS),
    );
  },
  discard: (id) => {
    const timer = removalTimers.get(id);
    if (timer !== undefined) clearTimeout(timer);
    removalTimers.delete(id);
    set({ strokes: get().strokes.filter((s) => s.id !== id) });
    setLocalLaser(get().strokes);
  },
}));
