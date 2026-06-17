import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface HiddenStore {
  /** Set of locally-hidden shape ids (keys present = hidden). */
  hidden: Record<string, true>;
  isHidden: (id: string) => boolean;
  hide: (ids: string[]) => void;
  show: (ids: string[]) => void;
  showAll: () => void;
  count: () => number;
}

/**
 * Per-user, local-only visibility. Hide is intentionally *not* in the shared
 * CRDT (unlike lock) — a tutor can declutter their own view without affecting
 * students. Shape ids are globally unique, so a single persisted set works
 * across boards.
 */
export const useHiddenStore = create<HiddenStore>()(
  persist(
    (set, get) => ({
      hidden: {},
      isHidden: (id) => !!get().hidden[id],
      hide: (ids) =>
        set((s) => {
          const next = { ...s.hidden };
          for (const id of ids) next[id] = true;
          return { hidden: next };
        }),
      show: (ids) =>
        set((s) => {
          const next = { ...s.hidden };
          for (const id of ids) delete next[id];
          return { hidden: next };
        }),
      showAll: () => set({ hidden: {} }),
      count: () => Object.keys(get().hidden).length,
    }),
    { name: 'whiteboard:hidden' },
  ),
);
