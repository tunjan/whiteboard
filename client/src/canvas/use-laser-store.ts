import { create } from 'zustand';
import type { Point } from '@whiteboard/shared';

export interface LaserPresence {
  /** Recent world-coordinate samples, oldest first. */
  points: Point[];
  /** True while the presenter is holding the pointer down. */
  active: boolean;
  /** Wall-clock time when the released trail should finish fading. */
  expiresAt: number | null;
}

interface LaserStore {
  laser: LaserPresence | null;
  setLaser: (laser: LaserPresence | null) => void;
}

/** Ephemeral local laser state. It is never written into the board document. */
export const useLaserStore = create<LaserStore>((set) => ({
  laser: null,
  setLaser: (laser) => set({ laser }),
}));
