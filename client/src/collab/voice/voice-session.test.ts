import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  acquireMic: vi.fn(),
  applyNoiseCancellation: vi.fn(),
  createVoiceGate: vi.fn(),
  setLocalVoice: vi.fn(),
  peers: [] as Array<Record<string, unknown>>,
  connectionStatus: 'connected' as string,
  presenceListeners: [] as Array<
    (state: { peers: Array<Record<string, unknown>> }) => void
  >,
  peerInstances: [] as Array<{
    fail: () => void;
    close: ReturnType<typeof vi.fn>;
    setVideoTrack: ReturnType<typeof vi.fn>;
    cameraTrack: MediaStreamTrack | null;
    screenTrack: MediaStreamTrack | null;
  }>,
}));

vi.mock('./mic', () => ({
  acquireMic: mocks.acquireMic,
  applyNoiseCancellation: mocks.applyNoiseCancellation,
}));

vi.mock('./voice-gate', async (importOriginal) => {
  const original = await importOriginal<typeof import('./voice-gate')>();
  return { ...original, createVoiceGate: mocks.createVoiceGate };
});

vi.mock('@/collab/presence', () => ({
  setLocalVoice: mocks.setLocalVoice,
}));

vi.mock('@/collab/use-connection-store', () => ({
  useConnectionStore: {
    getState: () => ({ status: mocks.connectionStatus }),
    subscribe: () => vi.fn(),
  },
}));

vi.mock('@/collab/use-presence-store', () => ({
  usePresenceStore: {
    getState: () => ({ peers: mocks.peers }),
    subscribe: (
      listener: (state: {
        peers: Array<Record<string, unknown>>;
      }) => void,
    ) => {
      mocks.presenceListeners.push(listener);
      return vi.fn();
    },
  },
}));

vi.mock('./peer-connection', () => ({
  VoicePeerConnection: class {
    readonly peerSessionId: string;
    readonly cameraTrack: MediaStreamTrack | null;
    readonly screenTrack: MediaStreamTrack | null;
    private readonly options: {
      onConnectionStateChange: (state: RTCPeerConnectionState) => void;
    };
    start = vi.fn().mockResolvedValue(undefined);
    handleSignal = vi.fn().mockResolvedValue(undefined);
    setVideoTrack = vi.fn().mockResolvedValue(undefined);
    sendBye = vi.fn();
    close = vi.fn();

    constructor(options: {
      peerSessionId: string;
      cameraTrack: MediaStreamTrack | null;
      screenTrack: MediaStreamTrack | null;
      onConnectionStateChange: (state: RTCPeerConnectionState) => void;
    }) {
      this.peerSessionId = options.peerSessionId;
      this.cameraTrack = options.cameraTrack;
      this.screenTrack = options.screenTrack;
      this.options = options;
      mocks.peerInstances.push(this);
    }

    fail() {
      this.options.onConnectionStateChange('failed');
    }
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function provider(clientID = 7) {
  return {
    awareness: { clientID },
    on: vi.fn(),
    off: vi.fn(),
    sendStateless: vi.fn(),
  };
}

function track() {
  return {
    stop: vi.fn(),
    enabled: false,
  } as unknown as MediaStreamTrack;
}

function callPeer(clientId: number, sessionId: string) {
  return {
    clientId,
    voice: {
      inCall: true,
      muted: true,
      speaking: false,
      camera: false,
      screen: false,
      sessionId,
    },
  };
}

/** The `stateless` handler `startVoiceSignaling` registered on the provider. */
function emitSignal(
  boardProvider: ReturnType<typeof provider>,
  payload: string,
): void {
  const call = boardProvider.on.mock.calls.find(
    ([event]) => event === 'stateless',
  );
  (call![1] as (event: { payload: string }) => void)({ payload });
}

/** The session id this client published with its own voice presence. */
function localSessionId(): string {
  const published = [...mocks.setLocalVoice.mock.calls]
    .reverse()
    .find(([voice]) => (voice as { inCall?: boolean } | null)?.inCall);
  return (published![0] as { sessionId: string }).sessionId;
}

function gate() {
  return {
    outboundTrack: track(),
    setMuted: vi.fn(),
    setThreshold: vi.fn(),
    replaceInput: vi.fn(),
    stop: vi.fn(),
  };
}

beforeEach(() => {
  vi.resetModules();
  mocks.acquireMic.mockReset();
  mocks.applyNoiseCancellation.mockReset();
  mocks.createVoiceGate.mockReset();
  mocks.setLocalVoice.mockReset();
  mocks.peers = [];
  mocks.connectionStatus = 'connected';
  mocks.presenceListeners = [];
  mocks.peerInstances = [];
});

describe('voice session lifecycle', () => {
  it('stops a microphone that resolves after cancelling a pending join', async () => {
    const pendingMic = deferred<MediaStreamTrack>();
    const lateTrack = track();
    mocks.acquireMic.mockReturnValueOnce(pendingMic.promise);
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider());

    const joining = session.joinVoice();
    expect(voiceStore.getState().status).toBe('connecting');
    session.leaveVoice();
    pendingMic.resolve(lateTrack);
    await joining;

    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(mocks.createVoiceGate).not.toHaveBeenCalled();
    expect(voiceStore.getState().status).toBe('idle');
    expect(mocks.setLocalVoice).toHaveBeenLastCalledWith(null);
  });

  it('tests the processed microphone without joining or publishing presence', async () => {
    const inputTrack = track();
    const voiceGate = gate();
    mocks.acquireMic.mockResolvedValueOnce(inputTrack);
    mocks.createVoiceGate.mockResolvedValueOnce(voiceGate);
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider());

    await session.startVoiceTest();
    const gateOptions = mocks.createVoiceGate.mock.calls[0]?.[1] as {
      onLevel: (level: { levelDb: number; speaking: boolean }) => void;
    };
    gateOptions.onLevel({ levelDb: -24, speaking: true });

    expect(voiceStore.getState().status).toBe('testing');
    expect(voiceStore.getState().inputLevelDb).toBe(-24);
    expect(voiceStore.getState().speaking).toBe(true);
    expect(voiceGate.setMuted).toHaveBeenCalledWith(false);
    expect(mocks.peerInstances).toHaveLength(0);
    expect(mocks.setLocalVoice).not.toHaveBeenCalledWith(
      expect.objectContaining({ inCall: true }),
    );
  });

  it('stops a microphone that resolves after cancelling a pending test', async () => {
    const pendingMic = deferred<MediaStreamTrack>();
    const lateTrack = track();
    mocks.acquireMic.mockReturnValueOnce(pendingMic.promise);
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider());

    const testing = session.startVoiceTest();
    expect(voiceStore.getState().status).toBe('test-connecting');
    session.stopVoiceTest();
    pendingMic.resolve(lateTrack);
    await testing;

    expect(lateTrack.stop).toHaveBeenCalledTimes(1);
    expect(mocks.createVoiceGate).not.toHaveBeenCalled();
    expect(voiceStore.getState().status).toBe('idle');
  });

  it('joins muted by promoting the active microphone test', async () => {
    const voiceGate = gate();
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(voiceGate);
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider());
    await session.startVoiceTest();

    await session.joinVoice();

    expect(mocks.acquireMic).toHaveBeenCalledTimes(1);
    expect(voiceGate.setMuted).toHaveBeenLastCalledWith(true);
    expect(voiceStore.getState().status).toBe('joined');
    expect(voiceStore.getState().muted).toBe(true);
    expect(mocks.setLocalVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        inCall: true,
        muted: true,
        speaking: false,
      }),
    );
  });

  it('applies noise-cancellation changes during a microphone test', async () => {
    const inputTrack = track();
    mocks.acquireMic.mockResolvedValueOnce(inputTrack);
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    mocks.applyNoiseCancellation.mockResolvedValueOnce({
      track: inputTrack,
      replaced: false,
    });
    const session = await import('./voice-session');
    session.bindVoiceProvider(provider());
    await session.startVoiceTest();

    session.setNoiseCancellation(false);
    await vi.waitFor(() => {
      expect(mocks.applyNoiseCancellation).toHaveBeenCalledWith(
        inputTrack,
        false,
      );
    });
  });

  it('does not publish a stale noise-cancellation error after leaving', async () => {
    const inputTrack = track();
    const voiceGate = gate();
    const pendingNoise = deferred<never>();
    mocks.acquireMic.mockResolvedValueOnce(inputTrack);
    mocks.createVoiceGate.mockResolvedValueOnce(voiceGate);
    mocks.applyNoiseCancellation.mockReturnValueOnce(pendingNoise.promise);
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider());
    await session.joinVoice();

    session.setNoiseCancellation(false);
    await vi.waitFor(() => {
      expect(mocks.applyNoiseCancellation).toHaveBeenCalledTimes(1);
    });
    session.leaveVoice();
    pendingNoise.reject(new Error('late failure'));
    await Promise.resolve();
    await Promise.resolve();

    expect(voiceStore.getState().status).toBe('idle');
    expect(voiceStore.getState().error).toBeNull();
  });

  it('requires an explicit retry after a peer connection fails', async () => {
    mocks.peers = [
      {
        clientId: 9,
        voice: {
          inCall: true,
          muted: true,
          speaking: false,
          sessionId: 'remote-session-1234',
        },
      },
    ];
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    session.bindVoiceProvider(provider(7));
    await session.joinVoice();
    expect(mocks.peerInstances).toHaveLength(1);

    mocks.peerInstances[0]!.fail();
    expect(voiceStore.getState().peerStatuses.get(9)).toBe('failed');
    mocks.presenceListeners.forEach((listener) =>
      listener({ peers: mocks.peers }),
    );
    expect(mocks.peerInstances).toHaveLength(1);

    session.retryFailedVoiceConnections();
    expect(mocks.peerInstances).toHaveLength(2);
    expect(voiceStore.getState().peerStatuses.get(9)).toBe('connecting');
  });

  it('asks a failed peer to clear its own block when retrying', async () => {
    mocks.peers = [callPeer(9, 'remote-session-1234')];
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    const { encodeVoiceSignal } = await import('@whiteboard/shared');
    const boardProvider = provider(7);
    session.bindVoiceProvider(boardProvider);
    await session.joinVoice();

    mocks.peerInstances[0]!.fail();
    boardProvider.sendStateless.mockClear();
    session.retryFailedVoiceConnections();

    expect(boardProvider.sendStateless).toHaveBeenCalledWith(
      encodeVoiceSignal({
        from: 7,
        to: 9,
        fromSessionId: localSessionId(),
        toSessionId: 'remote-session-1234',
        kind: 'retry',
      }),
    );
  });

  it('rebuilds a blocked connection when the peer asks to retry', async () => {
    mocks.peers = [callPeer(9, 'remote-session-1234')];
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    const voiceStore = (await import('./use-voice-store')).useVoiceStore;
    const { encodeVoiceSignal } = await import('@whiteboard/shared');
    const boardProvider = provider(7);
    session.bindVoiceProvider(boardProvider);
    await session.joinVoice();

    mocks.peerInstances[0]!.fail();
    expect(voiceStore.getState().peerStatuses.get(9)).toBe('failed');

    emitSignal(
      boardProvider,
      encodeVoiceSignal({
        from: 9,
        to: 7,
        fromSessionId: 'remote-session-1234',
        toSessionId: localSessionId(),
        kind: 'retry',
      }),
    );

    expect(mocks.peerInstances).toHaveLength(2);
    expect(voiceStore.getState().peerStatuses.get(9)).toBe('connecting');
  });

  it('fails a peer that never finishes connecting', async () => {
    vi.useFakeTimers();
    try {
      mocks.peers = [callPeer(9, 'remote-session-1234')];
      mocks.acquireMic.mockResolvedValueOnce(track());
      mocks.createVoiceGate.mockResolvedValueOnce(gate());
      const session = await import('./voice-session');
      const voiceStore = (await import('./use-voice-store')).useVoiceStore;
      session.bindVoiceProvider(provider(7));
      await session.joinVoice();
      expect(voiceStore.getState().peerStatuses.get(9)).toBe('connecting');

      vi.advanceTimersByTime(20_000);

      expect(voiceStore.getState().peerStatuses.get(9)).toBe('failed');
      expect(mocks.peerInstances[0]!.close).toHaveBeenCalledTimes(1);
      expect(voiceStore.getState().error).toBe('Voice connection timed out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps peer connections through a collaboration socket drop', async () => {
    mocks.peers = [callPeer(9, 'remote-session-1234')];
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    session.bindVoiceProvider(provider(7));
    await session.joinVoice();
    expect(mocks.peerInstances).toHaveLength(1);

    // A dropped socket removes every remote awareness state at once.
    mocks.connectionStatus = 'disconnected';
    mocks.presenceListeners.forEach((listener) => listener({ peers: [] }));
    expect(mocks.peerInstances[0]!.close).not.toHaveBeenCalled();

    mocks.connectionStatus = 'connected';
    mocks.presenceListeners.forEach((listener) =>
      listener({ peers: mocks.peers }),
    );
    expect(mocks.peerInstances).toHaveLength(1);
    expect(mocks.peerInstances[0]!.close).not.toHaveBeenCalled();
  });

  it('publishes a video track to current peers and announces it', async () => {
    mocks.peers = [callPeer(9, 'remote-session-1234')];
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    session.bindVoiceProvider(provider(7));
    await session.joinVoice();
    const cameraTrack = track();

    session.setLocalVideoTrack('camera', cameraTrack);

    expect(mocks.peerInstances[0]!.setVideoTrack).toHaveBeenCalledWith(
      'camera',
      cameraTrack,
    );
    expect(mocks.setLocalVoice).toHaveBeenLastCalledWith(
      expect.objectContaining({ camera: true, screen: false }),
    );

    session.setLocalVideoTrack('camera', null);

    expect(mocks.setLocalVoice).toHaveBeenLastCalledWith(
      expect.objectContaining({ camera: false }),
    );
  });

  it('gives a peer that joins later the video already being published', async () => {
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    session.bindVoiceProvider(provider(7));
    await session.joinVoice();
    const cameraTrack = track();
    session.setLocalVideoTrack('camera', cameraTrack);
    expect(mocks.peerInstances).toHaveLength(0);

    // Negotiation runs once, so a late peer only ever sees what it was built
    // with — this is the case that silently breaks if `ensurePeer` forgets.
    mocks.peers = [callPeer(9, 'remote-session-1234')];
    mocks.presenceListeners.forEach((listener) =>
      listener({ peers: mocks.peers }),
    );

    expect(mocks.peerInstances).toHaveLength(1);
    expect(mocks.peerInstances[0]!.cameraTrack).toBe(cameraTrack);
    expect(mocks.peerInstances[0]!.screenTrack).toBeNull();
  });

  it('stops local video tracks when leaving the call', async () => {
    mocks.acquireMic.mockResolvedValueOnce(track());
    mocks.createVoiceGate.mockResolvedValueOnce(gate());
    const session = await import('./voice-session');
    const videoStore = (await import('./use-video-store')).useVideoStore;
    session.bindVoiceProvider(provider(7));
    await session.joinVoice();
    const cameraTrack = track();
    const screenTrack = track();
    session.setLocalVideoTrack('camera', cameraTrack);
    session.setLocalVideoTrack('screen', screenTrack);
    videoStore.getState().setCameraEnabled(true);

    session.leaveVoice();

    expect(cameraTrack.stop).toHaveBeenCalledTimes(1);
    expect(screenTrack.stop).toHaveBeenCalledTimes(1);
    expect(videoStore.getState().cameraEnabled).toBe(false);
  });
});
