import { useEffect, useRef } from 'react';
import {
  formatAttentionDuration,
  shouldNotifyAttention,
  type AttentionState,
} from '@/collab/attention-state';
import { useAttentionStore } from '@/collab/use-attention-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { toast } from '@/components/ui/toast';

const attentionToastId = (clientId: number) => `attention:${clientId}`;

/**
 * Tell the tutor once per episode when a student drifts, and take it back the
 * moment they return: a warning that outlives its cause is a false alarm.
 *
 * Renders nothing and owns no viewport — these go through the board's shared
 * `Toaster`, which already stacks and dismisses. `useAttentionStore`
 * is empty for anyone who is not a tutor with alerts on, so this is inert on a
 * student's screen rather than merely hidden.
 */
export function AttentionToast() {
  const peers = useAttentionStore((state) => state.peers);
  const previous = useRef(new Map<number, AttentionState>());

  useEffect(() => {
    const names = new Map(
      usePresenceStore.getState().peers.map((p) => [p.clientId, p.name]),
    );

    for (const [clientId, entry] of peers) {
      const was = previous.current.get(clientId) ?? 'attentive';
      previous.current.set(clientId, entry.state);
      if (entry.state === 'attentive' && was !== 'attentive') {
        toast.close(attentionToastId(clientId));
      }
      if (!shouldNotifyAttention(was, entry.state)) continue;

      const name = names.get(clientId) ?? 'A student';
      const forHowLong = formatAttentionDuration(
        (performance.now() - entry.sinceMs) / 1_000,
      );
      toast.add({
        id: attentionToastId(clientId),
        title: `${name} may not be following`,
        description:
          entry.state === 'away'
            ? `Their board has been behind another window for ${forHowLong}.`
            : `No drawing, typing or panning for ${forHowLong}.`,
        type: 'warning',
      });
    }

    // Forget peers who have left, so a rejoin does not read as a continuing
    // episode and swallow the first alert of their next one.
    for (const clientId of previous.current.keys()) {
      if (peers.has(clientId)) continue;
      previous.current.delete(clientId);
      toast.close(attentionToastId(clientId));
    }
  }, [peers]);

  return null;
}
