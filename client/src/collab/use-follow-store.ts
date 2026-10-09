import { create } from 'zustand';

interface FollowStore {
  following: boolean;
  lastSummonApplied: number;
  /**
   * When a manual camera move last broke a follow (`performance.now()`), or 0.
   * A pan that ends a follow is usually a reflex, not a decision, so the
   * follow indicator keeps a short-lived "resume" offer keyed off this.
   */
  interruptedAt: number;
  setFollowing: (following: boolean) => void;
  toggle: () => void;
  setLastSummonApplied: (nonce: number) => void;
  clearInterrupted: () => void;
}

export const useFollowStore = create<FollowStore>((set) => ({
  following: false,
  lastSummonApplied: 0,
  interruptedAt: 0,
  setFollowing: (following) => set({ following, interruptedAt: 0 }),
  toggle: () => set((s) => ({ following: !s.following, interruptedAt: 0 })),
  setLastSummonApplied: (nonce) =>
    set((s) => ({ lastSummonApplied: Math.max(s.lastSummonApplied, nonce) })),
  clearInterrupted: () => set({ interruptedAt: 0 }),
}));

export function stopFollowingForManualCameraChange(): void {
  const store = useFollowStore.getState();
  if (store.following) {
    useFollowStore.setState({
      following: false,
      interruptedAt: performance.now(),
    });
  }
}
