import { create } from 'zustand';

interface FollowStore {
  following: boolean;
  lastSummonApplied: number;
  setFollowing: (following: boolean) => void;
  toggle: () => void;
  setLastSummonApplied: (nonce: number) => void;
}

export const useFollowStore = create<FollowStore>((set) => ({
  following: false,
  lastSummonApplied: 0,
  setFollowing: (following) => set({ following }),
  toggle: () => set((s) => ({ following: !s.following })),
  setLastSummonApplied: (nonce) =>
    set((s) => ({ lastSummonApplied: Math.max(s.lastSummonApplied, nonce) })),
}));

export function stopFollowingForManualCameraChange(): void {
  const store = useFollowStore.getState();
  if (store.following) store.setFollowing(false);
}
