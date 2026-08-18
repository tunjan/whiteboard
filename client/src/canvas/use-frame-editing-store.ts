import { create } from 'zustand';

interface FrameEditingStore {
  editingId: string | null;
  start: (id: string) => void;
  stop: () => void;
}

export const useFrameEditingStore = create<FrameEditingStore>((set) => ({
  editingId: null,
  start: (editingId) => set({ editingId }),
  stop: () => set({ editingId: null }),
}));
