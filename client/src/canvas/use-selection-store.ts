import { create } from 'zustand';
import type { Bounds } from '@whiteboard/shared';
import { setLocalSelection } from '@/collab/presence';
import type { MarqueeMode } from './selection-geometry';
import type { SnapGuide } from './snapping';

export interface MarqueeSelection {
  /** World-space bounds of the live selection rectangle. */
  bounds: Bounds;
  /** Intersect is the default; Ctrl/Command temporarily switches to wrap. */
  mode: MarqueeMode;
}

interface SelectionStore {
  selectedIds: string[];
  /** Live rectangle selection while drag-selecting, else null. */
  marquee: MarqueeSelection | null;
  /** Live alignment guides during a snapping drag. */
  snapGuides: SnapGuide[];
  /** Canvas-level cursor while a corner rotation gesture is active. */
  rotationCursor: string | null;
  setSelection: (ids: string[]) => void;
  add: (ids: string[]) => void;
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  setMarquee: (marquee: MarqueeSelection | null) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setRotationCursor: (cursor: string | null) => void;
}

// Selection is per-user, local UI state — never in the shared CRDT. It is
// mirrored to peers through awareness (setLocalSelection) so they can see what
// each collaborator is working on, the same way laser strokes are shared.
export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: [],
  marquee: null,
  snapGuides: [],
  rotationCursor: null,
  setSelection: (selectedIds) => {
    const current = get().selectedIds;
    if (
      current.length === selectedIds.length &&
      current.every((id) => selectedIds.includes(id))
    ) {
      return;
    }
    set({ selectedIds });
    setLocalSelection(selectedIds);
  },
  add: (ids) => {
    set((s) => ({ selectedIds: [...new Set([...s.selectedIds, ...ids])] }));
    setLocalSelection(get().selectedIds);
  },
  toggle: (id) => {
    set((s) => ({
      selectedIds: s.selectedIds.includes(id)
        ? s.selectedIds.filter((x) => x !== id)
        : [...s.selectedIds, id],
    }));
    setLocalSelection(get().selectedIds);
  },
  clear: () => {
    set({ selectedIds: [] });
    setLocalSelection([]);
  },
  has: (id) => get().selectedIds.includes(id),
  setMarquee: (marquee) => set({ marquee }),
  setSnapGuides: (snapGuides) => set({ snapGuides }),
  setRotationCursor: (rotationCursor) => set({ rotationCursor }),
}));
