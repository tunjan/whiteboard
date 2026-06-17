import { create } from 'zustand';

interface EnteredGroupStore {
  /** The group currently "entered" for editing its members directly, or null. */
  enteredGroupId: string | null;
  enter: (id: string) => void;
  exit: () => void;
}

// Local, transient UI state — which group the user has stepped into.
export const useEnteredGroupStore = create<EnteredGroupStore>((set) => ({
  enteredGroupId: null,
  enter: (enteredGroupId) => set({ enteredGroupId }),
  exit: () => set({ enteredGroupId: null }),
}));
