import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLatencyMonitor } from './latency';
import { useConnectionStore } from './use-connection-store';

function makeProvider() {
  const listeners = new Map<string, Set<(event: any) => void>>();
  const provider = {
    on: vi.fn((event: string, listener: (event: any) => void) => {
      const eventListeners = listeners.get(event) ?? new Set();
      eventListeners.add(listener);
      listeners.set(event, eventListeners);
      return provider;
    }),
    off: vi.fn((event: string, listener: (event: any) => void) => {
      listeners.get(event)?.delete(listener);
      return provider;
    }),
    sendStateless: vi.fn(),
    emit: (event: string, payload: any) => {
      listeners.get(event)?.forEach((listener) => listener(payload));
    },
  };
  return provider;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  useConnectionStore.setState({ status: 'connecting', latencyMs: null });
});

describe('startLatencyMonitor', () => {
  it('records the echoed collaboration round-trip time', () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    const publishLatency = vi.fn();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(142);
    useConnectionStore.getState().setStatus('connected');

    const stop = startLatencyMonitor(provider, publishLatency);
    provider.emit('status', { status: 'connected' });
    expect(provider.sendStateless).toHaveBeenCalledWith(
      `${LATENCY_MESSAGE_PREFIX}100`,
    );

    provider.emit('stateless', {
      payload: `${LATENCY_MESSAGE_PREFIX}100`,
    });
    expect(useConnectionStore.getState().latencyMs).toBe(42);
    expect(publishLatency).toHaveBeenCalledWith(42);

    stop();
    expect(useConnectionStore.getState().latencyMs).toBeNull();
    expect(publishLatency).toHaveBeenLastCalledWith(null);
  });
});
