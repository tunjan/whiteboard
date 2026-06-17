import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface ToolLockStore {
  /** When on, creation tools stay active after placing a shape (no revert). */
  locked: boolean;
  toggle: () => void;
  setLocked: (v: boolean) => void;
}

// Per-user preference, persisted locally (mirrors use-theme-store). Drawing
// tools call ctx.complete() when finished; the flag decides whether that reverts
// to Select. Draw/Eraser/Hand never call complete(), so the flag never touches
// them.
export const useToolLockStore = create<ToolLockStore>()(
  persist(
    (set, get) => ({
      locked: false,
      toggle: () => set({ locked: !get().locked }),
      setLocked: (locked) => set({ locked }),
    }),
    { name: 'whiteboard:tool-lock' },
  ),
);
