import { useEffect } from 'react';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { type PeerPresence, usePresenceStore } from '@/collab/use-presence-store';
import { toast } from '@/components/ui/toast';

const TOAST_TIMEOUT_MS = 4_000;

/** A person, not a connection: a refresh reconnects under a new client id, and
 *  announcing the same student twice for it would be noise. */
function personKey(peer: PeerPresence): string {
  return `${peer.name}\u0000${peer.color}`;
}

/**
 * Toast each person who arrives while the board is open. Whoever was already
 * here when it finished loading is the room you walked into, not news, so only
 * later arrivals are announced — and each person once per visit.
 */
export function useArrivalToasts(enabled: boolean): void {
  const ready = useBoardLoadingStore((s) => s.ready);

  useEffect(() => {
    if (!enabled || !ready) return;
    const seen = new Set(usePresenceStore.getState().peers.map(personKey));
    return usePresenceStore.subscribe(({ peers }) => {
      for (const peer of peers) {
        const key = personKey(peer);
        if (seen.has(key)) continue;
        seen.add(key);
        toast.add({ title: `${peer.name} joined`, timeout: TOAST_TIMEOUT_MS });
      }
    });
  }, [enabled, ready]);
}
