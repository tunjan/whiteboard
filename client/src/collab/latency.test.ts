import { LATENCY_MESSAGE_PREFIX } from '@whiteboard/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
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
  useBoardLoadingStore.setState({ ready: false, stage: 'local' });
});

describe('startLatencyMonitor', () => {
  it('records the echoed collaboration round-trip time', () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    const publishLatency = vi.fn();
    const now = vi.spyOn(performance, 'now');
    now.mockReturnValueOnce(100).mockReturnValueOnce(142);
    useConnectionStore.getState().setStatus('connected');
    useBoardLoadingStore.setState({ ready: true, stage: 'ready' });

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

  // The first ping used to go out the instant the socket connected, which is
  // when the initial sync burst is still draining it: the reply came back over
  // the one-second threshold and greeted the user with "Slow connection".
  it('sends nothing while the board is still joining', () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    useConnectionStore.getState().setStatus('connected');

    const stop = startLatencyMonitor(provider, vi.fn());
    provider.emit('status', { status: 'connected' });
    vi.advanceTimersByTime(20_000);

    expect(provider.sendStateless).not.toHaveBeenCalled();
    stop();
  });

  it('takes its first sample the moment the board is ready', () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    useConnectionStore.getState().setStatus('connected');

    const stop = startLatencyMonitor(provider, vi.fn());
    useBoardLoadingStore.setState({ ready: true, stage: 'ready' });

    expect(provider.sendStateless).toHaveBeenCalledTimes(1);
    stop();
  });

  it('stops watching for readiness once torn down', () => {
    vi.useFakeTimers();
    const provider = makeProvider();
    useConnectionStore.getState().setStatus('connected');

    startLatencyMonitor(provider, vi.fn())();
    useBoardLoadingStore.setState({ ready: true, stage: 'ready' });

    expect(provider.sendStateless).not.toHaveBeenCalled();
  });
});
