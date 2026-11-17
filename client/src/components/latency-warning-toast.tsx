import { useEffect, useRef } from 'react';
import { nextHighLatencyEpisode } from '@/collab/high-latency';
import { useConnectionStore } from '@/collab/use-connection-store';
import { toast } from '@/components/ui/toast';

const TOAST_ID = 'slow-connection';
const RECOVERED_TIMEOUT_MS = 2_500;

/**
 * Warn the current user for as long as an episode of high latency lasts, then
 * turn the same toast into the all-clear. The numbers stay in the connection
 * indicator; here the reader only needs to know what it means for them. Losing
 * the link outright isn't a recovery, and the indicator says Offline by itself.
 */
export function LatencyWarningToast() {
  const latencyMs = useConnectionStore((state) => state.latencyMs);
  const episodeActive = useRef(false);

  useEffect(() => {
    const transition = nextHighLatencyEpisode(
      episodeActive.current,
      latencyMs,
    );
    const ended = episodeActive.current && !transition.active;
    episodeActive.current = transition.active;

    if (transition.shouldNotify) {
      toast.add({
        id: TOAST_ID,
        title: 'Slow connection',
        description: 'Your changes may take a moment to reach everyone.',
        timeout: 0,
        type: 'warning',
      });
    } else if (ended && latencyMs === null) {
      toast.close(TOAST_ID);
    } else if (ended) {
      toast.update(TOAST_ID, {
        title: 'Connection recovered',
        description: undefined,
        timeout: RECOVERED_TIMEOUT_MS,
        type: 'success',
      });
    }
  }, [latencyMs]);

  return null;
}
