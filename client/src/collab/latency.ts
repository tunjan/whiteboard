import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { useConnectionStore } from './use-connection-store';

const MEASUREMENT_INTERVAL_MS = 5_000;

interface LatencyProvider {
  on: (event: string, listener: (event: any) => void) => unknown;
  off: (event: string, listener: (event: any) => void) => unknown;
  sendStateless: (payload: string) => void;
}

/** Measure round-trip latency over the board's existing collaboration socket. */
export function startLatencyMonitor(
  provider: LatencyProvider,
  publishLatency: (latencyMs: number | null) => void,
): () => void {
  const measure = () => {
    if (useConnectionStore.getState().status !== 'connected') return;
    provider.sendStateless(`${LATENCY_MESSAGE_PREFIX}${performance.now()}`);
  };
  const onStatus = ({ status }: { status: string }) => {
    if (status === 'connected') {
      measure();
    } else {
      publishLatency(null);
    }
  };
  const onStateless = ({ payload }: { payload: string }) => {
    if (!payload.startsWith(LATENCY_MESSAGE_PREFIX)) return;
    const sentAt = Number(payload.slice(LATENCY_MESSAGE_PREFIX.length));
    if (!Number.isFinite(sentAt)) return;
    const latencyMs = Math.max(0, Math.round(performance.now() - sentAt));
    useConnectionStore.getState().setLatency(latencyMs);
    publishLatency(latencyMs);
  };

  provider.on('status', onStatus);
  provider.on('stateless', onStateless);
  const interval = setInterval(measure, MEASUREMENT_INTERVAL_MS);

  return () => {
    clearInterval(interval);
    provider.off('status', onStatus);
    provider.off('stateless', onStateless);
    useConnectionStore.getState().setLatency(null);
    publishLatency(null);
  };
}
