import { create } from 'zustand';

interface TextEditingStore {
  /** Id of the text shape currently being edited, or null. */
  editingId: string | null;
  /** Native textarea selection requested when the overlay mounts. */
  anchor: number | null;
  head: number | null;
  start: (id: string, selection?: { anchor: number; head?: number }) => void;
  stop: () => void;
}

export const useTextEditingStore = create<TextEditingStore>((set) => ({
  editingId: null,
  anchor: null,
  head: null,
  start: (editingId, selection) =>
    set({
      editingId,
      anchor: selection?.anchor ?? null,
      head: selection?.head ?? selection?.anchor ?? null,
    }),
  stop: () => set({ editingId: null, anchor: null, head: null }),
}));
