import { create } from 'zustand';
import type { Shape } from '@whiteboard/shared';

interface EraserCutStore {
  /** Surviving fragments per cut shape id; an empty array means fully erased. */
  fragments: Record<string, Shape[]>;
  /** Replace the whole map (the eraser tool owns it for the length of a stroke). */
  set: (fragments: Record<string, Shape[]>) => void;
  clear: () => void;
}

/**
 * Local, transient preview state for the precision eraser, mirroring
 * {@link import('./use-eraser-store').useEraserStore} for the whole-shape queue.
 *
 * While a precision stroke is in progress the document is untouched; the canvas
 * renders these fragments in place of the shapes they came from, so ink vanishes
 * under the cursor without a write per pointer sample. The tool commits the whole
 * cut in one transaction on release, or drops it on cancel. Never part of the
 * CRDT — it does not leave this client and resets when the stroke ends.
 */
export const useEraserCutStore = create<EraserCutStore>((set, get) => ({
  fragments: {},
  set: (fragments) => set({ fragments }),
  clear: () => {
    if (Object.keys(get().fragments).length === 0) return;
    set({ fragments: {} });
  },
}));
