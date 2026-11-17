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

export type SelectionGesture = 'move' | 'resize' | 'rotate';

interface SelectionStore {
  selectedIds: string[];
  /** Live rectangle selection while drag-selecting, else null. */
  marquee: MarqueeSelection | null;
  /** Live alignment guides during a snapping drag. */
  snapGuides: SnapGuide[];
  /**
   * Canvas-level cursor held for the duration of a resize or rotate gesture.
   * The pointer leaves the handle as soon as the drag starts, so the cursor has
   * to be pinned to the surface rather than left to the handle's own hover.
   */
  gestureCursor: string | null;
  /**
   * The gesture transforming the selection, if any. Its box, handles and
   * toolbar step aside for it, as tldraw's do.
   */
  transforming: SelectionGesture | null;
  setSelection: (ids: string[]) => void;
  add: (ids: string[]) => void;
  toggle: (id: string) => void;
  clear: () => void;
  has: (id: string) => boolean;
  setMarquee: (marquee: MarqueeSelection | null) => void;
  setSnapGuides: (guides: SnapGuide[]) => void;
  setGestureCursor: (cursor: string | null) => void;
  setTransforming: (gesture: SelectionGesture | null) => void;
}

// Selection is per-user, local UI state — never in the shared CRDT. It is
// mirrored to peers through awareness (setLocalSelection) so they can see what
// each collaborator is working on, the same way laser strokes are shared.
export const useSelectionStore = create<SelectionStore>((set, get) => ({
  selectedIds: [],
  marquee: null,
  snapGuides: [],
  gestureCursor: null,
  transforming: null,
  setSelection: (selectedIds) => {
    const current = get().selectedIds;
    // A marquee drag calls this every frame, almost always with the same ids.
    // `includes` inside `every` made that no-op check quadratic — 2.7 ms per
    // frame at 2000 selected, against 0.04 ms through a Set.
    if (current.length === selectedIds.length) {
      const next = new Set(selectedIds);
      if (current.every((id) => next.has(id))) return;
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
  setGestureCursor: (gestureCursor) => set({ gestureCursor }),
  // Called on every pointer sample of a gesture; only a change notifies.
  setTransforming: (transforming) => {
    if (get().transforming !== transforming) set({ transforming });
  },
}));
