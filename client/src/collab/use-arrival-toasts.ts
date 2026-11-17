import { useEffect } from 'react';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { type PeerPresence, usePresenceStore } from '@/collab/use-presence-store';
import { playAgentSound } from '@/components/agent-sound';
import { toast } from '@/components/ui/toast';

/** A person, not a connection: a refresh reconnects under a new client id, and
 *  announcing the same student twice for it would be noise. */
function personKey(peer: PeerPresence): string {
  return `${peer.name}\u0000${peer.color}`;
}

export function joinedTitle(names: readonly string[]): string {
  const [first, second, ...rest] = names;
  if (second === undefined) return `${first} joined`;
  if (!rest.length) return `${first} and ${second} joined`;
  return `${first}, ${second} and ${rest.length} ${rest.length === 1 ? 'other' : 'others'} joined`;
}

/**
 * Toast each person who arrives while the board is open. Whoever was already
 * here when it finished loading is the room you walked into, not news, so only
 * later arrivals are announced — and each person once per visit.
 *
 * A class arrives all at once, so one toast grows rather than a stack per
 * student. And a tutor who shared the link has usually gone to another tab to
 * wait: there the news goes in the tab's title, with a chime.
 */
export function useArrivalToasts(enabled: boolean): void {
  const ready = useBoardLoadingStore((s) => s.ready);

  useEffect(() => {
    if (!enabled || !ready) return;
    const seen = new Set(usePresenceStore.getState().peers.map(personKey));
    const arrivals: PeerPresence[] = [];
    const boardTitle = document.title;
    const restoreTitle = () => {
      if (!document.hidden) document.title = boardTitle;
    };
    document.addEventListener('visibilitychange', restoreTitle);

    const unsubscribe = usePresenceStore.subscribe(({ peers }) => {
      const fresh = peers.filter((peer) => !seen.has(personKey(peer)));
      if (!fresh.length) return;
      for (const peer of fresh) seen.add(personKey(peer));
      arrivals.push(...fresh);

      const title = joinedTitle(arrivals.map((peer) => peer.name));
      toast.add({
        id: 'arrivals',
        title,
        data: { people: [...arrivals] },
        onClose: () => {
          arrivals.length = 0;
        },
      });
      if (document.hidden) {
        document.title = `${title} · ${boardTitle}`;
        playAgentSound('done');
      }
    });

    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', restoreTitle);
      document.title = boardTitle;
    };
  }, [enabled, ready]);
}
