import { create } from 'zustand';
import type { Bounds, Point } from '@whiteboard/shared';
import type { SnapGuide } from './snapping';

interface SelectionStore {
  selectedIds: string[];
  /** Live marquee rectangle (world bounds) while drag-selecting, else null. */
  marquee: Bounds | null;
  /** Live lasso polygon (world points) while lasso-selecting, else null. */
  lasso: Point[] | null;
  /** Live alignment guides during a snapping drag. */
  snapGuides: SnapGuide[];
  setSelection: (ids: string[]) => void;
  add: (ids: string[]) => void;
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  setMarquee: (bounds: Bounds | null) => void;
  setLasso: (points: Point[] | null) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
}

// Selection is per-user, local UI state — never in the shared CRDT.
export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: [],
  marquee: null,
  lasso: null,
  snapGuides: [],
  setSelection: (selectedIds) => set({ selectedIds }),
  add: (ids) =>
    set((s) => ({ selectedIds: [...new Set([...s.selectedIds, ...ids])] })),
  toggle: (id) =>
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    })),
  clear: () => set({ selectedIds: [] }),
  has: (id) => get().selectedIds.includes(id),
  setMarquee: (marquee) => set({ marquee }),
  setLasso: (lasso) => set({ lasso }),
  setSnapGuides: (snapGuides) => set({ snapGuides }),
}));
