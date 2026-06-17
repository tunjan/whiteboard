import { create } from 'zustand';

interface TextEditingStore {
  /** Id of the text shape currently being edited, or null. */
  editingId: string | null;
  start: (id: string) => void;
  stop: () => void;
}

export const useTextEditingStore = create<TextEditingStore>((set) => ({
  editingId: null,
  start: (editingId) => set({ editingId }),
  stop: () => set({ editingId: null }),
}));
