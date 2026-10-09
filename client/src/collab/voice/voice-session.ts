import {
  encodeVoiceSignal,
  type VideoKind,
  type VoiceSignal,
} from '@whiteboard/shared';
import { setLocalVoice } from '@/collab/presence';
import { useConnectionStore } from '@/collab/use-connection-store';
import {
  type PeerPresence,
  usePresenceStore,
} from '@/collab/use-presence-store';
import { acquireMic, applyNoiseCancellation } from './mic';
import { VoicePeerConnection } from './peer-connection';
import {
  startVoiceSignaling,
  type VoiceSignalingProvider,
} from './signaling';
import { useVideoStore } from './use-video-store';
import { useVoiceStore } from './use-voice-store';
import {
  createVoiceGate,
  type VoiceGate,
  type VoiceGateLevel,
} from './voice-gate';

const DISCONNECTED_PEER_TIMEOUT_MS = 10_000;
// A peer whose offer never arrived stays in `new` forever, so the connection
// state machine alone never reports it as failed.
const CONNECTING_PEER_TIMEOUT_MS = 20_000;

let provider: VoiceSignalingProvider | null = null;
let localClientId: number | null = null;
let localSessionId: string | null = null;
let localTrack: MediaStreamTrack | null = null;
// Held here rather than in the video store because `ensurePeer` needs the live
// tracks when it builds a connection: negotiation runs once, so a peer that
// joins later can only receive video that was attached at construction.
let localCameraTrack: MediaStreamTrack | null = null;
let localScreenTrack: MediaStreamTrack | null = null;
let voiceGate: VoiceGate | null = null;
let activeBindingCleanup: (() => void) | null = null;
let joinGeneration = 0;
let noiseQueue = Promise.resolve();
let lastPublishedSpeaking = false;

const peerConnections = new Map<number, VoicePeerConnection>();
const blockedPeerSessions = new Map<
  number,
  { sessionId: string; reason: 'failed' | 'bye' }
>();
const peerTimers = new Map<number, ReturnType<typeof setTimeout>>();

export async function joinVoice(): Promise<void> {
  const binding = provider;
  const clientId = binding?.awareness?.clientID;
  if (clientId === undefined) {
    useVoiceStore.getState().setError('Voice is still connecting');
    return;
  }
  const currentStatus = useVoiceStore.getState().status;
  if (
    currentStatus === 'testing' &&
    localTrack &&
    voiceGate
  ) {
    promoteVoiceTestToCall(clientId);
    return;
  }
  if (currentStatus !== 'idle') return;

  const generation = ++joinGeneration;
  const store = useVoiceStore.getState();
  const requestedNoiseCancellation = store.noiseCancellation;
  store.setError(null);
  store.setStatus('connecting');

  let track: MediaStreamTrack | null = null;
  let gate: VoiceGate | null = null;
  try {
    track = await acquireMic(requestedNoiseCancellation);
    if (!isPendingJoinCurrent(generation, binding, clientId)) {
      track.stop();
      return;
    }

    gate = await createVoiceGate(track, {
      thresholdDb: useVoiceStore.getState().gateThresholdDb,
      onLevel: handleGateLevel,
    });
    if (!isPendingJoinCurrent(generation, binding, clientId)) {
      gate.stop();
      track.stop();
      return;
    }

    localClientId = clientId;
    localSessionId = createVoiceSessionId();
    localTrack = track;
    voiceGate = gate;
    blockedPeerSessions.clear();
    clearAllPeerTimers();
    lastPublishedSpeaking = false;
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().setInputLevel(
      useVoiceStore.getState().inputLevelDb,
      false,
    );
    useVoiceStore.getState().setStatus('joined');
    publishLocalVoice();
    reconcilePeers(usePresenceStore.getState().peers);
    if (
      useVoiceStore.getState().noiseCancellation !==
      requestedNoiseCancellation
    ) {
      setNoiseCancellation(
        useVoiceStore.getState().noiseCancellation,
      );
    }
  } catch (error) {
    gate?.stop();
    track?.stop();
    if (generation !== joinGeneration || provider !== binding) return;
    useVoiceStore.getState().setStatus('idle');
    useVoiceStore.getState().setError(errorMessage(error));
  }
}

/**
 * Check the processed microphone locally without joining the room or
 * publishing voice awareness. The same gate and capture path are reused when
 * the user joins from the test.
 */
export async function startVoiceTest(): Promise<void> {
  if (useVoiceStore.getState().status !== 'idle') return;

  const generation = ++joinGeneration;
  const binding = provider;
  const store = useVoiceStore.getState();
  const requestedNoiseCancellation = store.noiseCancellation;
  store.setError(null);
  store.setStatus('test-connecting');

  let track: MediaStreamTrack | null = null;
  let gate: VoiceGate | null = null;
  try {
    track = await acquireMic(requestedNoiseCancellation);
    if (!isPendingVoiceTestCurrent(generation, binding)) {
      track.stop();
      return;
    }

    gate = await createVoiceGate(track, {
      thresholdDb: useVoiceStore.getState().gateThresholdDb,
      onLevel: handleGateLevel,
    });
    if (!isPendingVoiceTestCurrent(generation, binding)) {
      gate.stop();
      track.stop();
      return;
    }

    localClientId = null;
    localSessionId = null;
    localTrack = track;
    voiceGate = gate;
    lastPublishedSpeaking = false;
    useVoiceStore.getState().setMuted(true);
    useVoiceStore.getState().setInputLevel(
      useVoiceStore.getState().inputLevelDb,
      false,
    );
    useVoiceStore.getState().setStatus('testing');
    gate.setMuted(false);
    if (
      useVoiceStore.getState().noiseCancellation !==
      requestedNoiseCancellation
    ) {
      setNoiseCancellation(
        useVoiceStore.getState().noiseCancellation,
      );
    }
  } catch (error) {
    gate?.stop();
    track?.stop();
    if (generation !== joinGeneration || provider !== binding) return;
    useVoiceStore.getState().setStatus('idle');
    useVoiceStore.getState().setError(errorMessage(error));
  }
}

export function stopVoiceTest(): void {
  const status = useVoiceStore.getState().status;
  if (status === 'test-connecting' || status === 'testing') {
    leaveVoice();
  }
}

export function leaveVoice(): void {
  joinGeneration += 1;

  for (const peer of peerConnections.values()) peer.sendBye();
  // Snapshot: removePeer mutates the map.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const peerClientId of [...peerConnections.keys()]) {
    removePeer(peerClientId);
  }

  blockedPeerSessions.clear();
  clearAllPeerTimers();
  voiceGate?.stop();
  voiceGate = null;
  localTrack?.stop();
  localTrack = null;
  localCameraTrack?.stop();
  localCameraTrack = null;
  localScreenTrack?.stop();
  localScreenTrack = null;
  localClientId = null;
  localSessionId = null;
  lastPublishedSpeaking = false;
  noiseQueue = Promise.resolve();
  setLocalVoice(null);
  useVoiceStore.getState().resetSession();
  useVideoStore.getState().resetSession();
}

/**
 * Publish or clear one video slot across the whole mesh. Every peer connection
 * already carries an empty camera and screen transceiver, so this is a track
 * swap on each — no renegotiation, no signaling.
 */
export function setLocalVideoTrack(
  kind: VideoKind,
  track: MediaStreamTrack | null,
): void {
  if (kind === 'camera') localCameraTrack = track;
  else localScreenTrack = track;
  for (const peer of peerConnections.values()) {
    void peer.setVideoTrack(kind, track);
  }
  publishLocalVoice();
}

export function setMuted(muted: boolean): void {
  if (!voiceGate || useVoiceStore.getState().status !== 'joined') return;
  voiceGate.setMuted(muted);
  useVoiceStore.getState().setMuted(muted);
  if (muted) {
    useVoiceStore.getState().setInputLevel(
      useVoiceStore.getState().inputLevelDb,
      false,
    );
  }
  publishLocalVoice();
}

export function setGateThreshold(thresholdDb: number): void {
  useVoiceStore.getState().setGateThreshold(thresholdDb);
  voiceGate?.setThreshold(useVoiceStore.getState().gateThresholdDb);
}

export function setNoiseCancellation(enabled: boolean): void {
  useVoiceStore.getState().setNoiseCancellation(enabled);
  const status = useVoiceStore.getState().status;
  if (!localTrack || (status !== 'joined' && status !== 'testing')) {
    return;
  }

  const generation = joinGeneration;
  const binding = provider;
  noiseQueue = noiseQueue
    .then(async () => {
      const track = localTrack;
      if (!track || !isCurrentCapture(generation, binding)) return;
      const desired = useVoiceStore.getState().noiseCancellation;
      const result = await applyNoiseCancellation(track, desired);

      if (
        localTrack !== track ||
        !isCurrentCapture(generation, binding)
      ) {
        if (result.replaced) result.track.stop();
        return;
      }
      if (!result.replaced) {
        useVoiceStore.getState().setError(null);
        return;
      }
      if (!voiceGate) {
        result.track.stop();
        return;
      }

      voiceGate.replaceInput(result.track);
      localTrack = result.track;
      track.stop();
      useVoiceStore.getState().setError(null);
    })
    .catch((error: unknown) => {
      if (isCurrentCapture(generation, binding)) {
        useVoiceStore.getState().setError(errorMessage(error));
      }
    });
}

export function retryFailedVoiceConnections(): void {
  if (useVoiceStore.getState().status !== 'joined') return;
  for (const [clientId, blocked] of blockedPeerSessions) {
    if (blocked.reason !== 'failed') continue;
    blockedPeerSessions.delete(clientId);
    useVoiceStore.getState().setPeerStatus(clientId, null);
    // A connection failure is symmetric, so the peer blocked this session too
    // and will not offer again on its own. Clearing only our side leaves the
    // retry stuck at `connecting`, so ask the peer to clear its block as well.
    sendRetry(clientId, blocked.sessionId);
  }
  useVoiceStore.getState().setError(null);
  reconcilePeers(usePresenceStore.getState().peers);
}

function sendRetry(peerClientId: number, peerSessionId: string): void {
  const binding = provider;
  const sessionId = localSessionId;
  if (!binding || localClientId === null || !sessionId) return;
  binding.sendStateless(
    encodeVoiceSignal({
      from: localClientId,
      to: peerClientId,
      fromSessionId: sessionId,
      toSessionId: peerSessionId,
      kind: 'retry',
    }),
  );
}

/**
 * Bind voice signaling to the active board provider. Cleanup always leaves the
 * call before the provider and awareness are destroyed.
 */
export function bindVoiceProvider(
  nextProvider: VoiceSignalingProvider,
): () => void {
  activeBindingCleanup?.();
  provider = nextProvider;
  localClientId = null;
  localSessionId = null;

  const stopSignaling = startVoiceSignaling(nextProvider, (signal) => {
    void handleSignal(signal, nextProvider);
  });
  const stopPresence = usePresenceStore.subscribe((state) => {
    reconcilePeers(state.peers);
  });
  // Reconciling is suppressed while the socket is down, so reconnecting has to
  // drive its own pass rather than waiting for the next presence change.
  const stopConnection = useConnectionStore.subscribe(() => {
    reconcilePeers(usePresenceStore.getState().peers);
  });

  const cleanup = () => {
    if (activeBindingCleanup !== cleanup) return;
    leaveVoice();
    stopConnection();
    stopPresence();
    stopSignaling();
    provider = null;
    activeBindingCleanup = null;
  };
  activeBindingCleanup = cleanup;
  return cleanup;
}

async function handleSignal(
  signal: VoiceSignal,
  sourceProvider: VoiceSignalingProvider,
): Promise<void> {
  const sessionId = localSessionId;
  if (
    provider !== sourceProvider ||
    !localTrack ||
    !voiceGate ||
    localClientId === null ||
    !sessionId ||
    signal.to !== localClientId ||
    signal.toSessionId !== sessionId ||
    useVoiceStore.getState().status !== 'joined'
  ) {
    return;
  }

  const remote = usePresenceStore
    .getState()
    .peers.find((peer) => peer.clientId === signal.from);
  if (
    !remote?.voice?.inCall ||
    remote.voice.sessionId !== signal.fromSessionId
  ) {
    return;
  }

  if (signal.kind === 'bye') {
    blockedPeerSessions.set(signal.from, {
      sessionId: signal.fromSessionId,
      reason: 'bye',
    });
    removePeer(signal.from);
    return;
  }

  // The peer is restarting this connection: drop our own failure block and any
  // half-open connection so both sides renegotiate from `new`.
  if (signal.kind === 'retry') {
    const blocked = blockedPeerSessions.get(signal.from);
    if (
      blocked?.reason === 'failed' &&
      blocked.sessionId === signal.fromSessionId
    ) {
      blockedPeerSessions.delete(signal.from);
    }
    removePeer(signal.from);
    reconcilePeers(usePresenceStore.getState().peers);
    return;
  }

  const peer = ensurePeer(signal.from, signal.fromSessionId);
  if (!peer) return;
  try {
    await peer.handleSignal(signal);
  } catch (error) {
    if (
      provider !== sourceProvider ||
      localSessionId !== sessionId ||
      peerConnections.get(signal.from) !== peer
    ) {
      return;
    }
    markPeerFailed(signal.from, peer, signal.fromSessionId, error);
  }
}

function reconcilePeers(peers: PeerPresence[]): void {
  if (
    !localTrack ||
    !voiceGate ||
    localClientId === null ||
    !localSessionId ||
    useVoiceStore.getState().status !== 'joined'
  ) {
    return;
  }

  // A dropped collaboration socket clears every remote awareness state at once,
  // which would read as "everyone left the call". The audio mesh does not run
  // over that socket, so healthy connections stay up until presence is
  // trustworthy again — the peers repopulate on reconnect and reconcile then.
  if (useConnectionStore.getState().status !== 'connected') return;

  const desiredPeers = new Map<number, string>();
  for (const peer of peers) {
    if (peer.voice?.inCall) {
      desiredPeers.set(peer.clientId, peer.voice.sessionId);
    }
  }

  for (const [peerClientId, peer] of peerConnections) {
    if (desiredPeers.get(peerClientId) !== peer.peerSessionId) {
      removePeer(peerClientId);
    }
  }
  for (const [peerClientId, blocked] of blockedPeerSessions) {
    if (desiredPeers.get(peerClientId) !== blocked.sessionId) {
      blockedPeerSessions.delete(peerClientId);
      useVoiceStore.getState().setPeerStatus(peerClientId, null);
    }
  }
  desiredPeers.forEach((peerSessionId, peerClientId) => {
    ensurePeer(peerClientId, peerSessionId);
  });
}

function ensurePeer(
  peerClientId: number,
  peerSessionId: string,
): VoicePeerConnection | null {
  const existing = peerConnections.get(peerClientId);
  if (existing?.peerSessionId === peerSessionId) return existing;
  if (existing) removePeer(peerClientId);

  const blocked = blockedPeerSessions.get(peerClientId);
  if (blocked?.sessionId === peerSessionId) return null;
  if (blocked) {
    blockedPeerSessions.delete(peerClientId);
    useVoiceStore.getState().setPeerStatus(peerClientId, null);
  }

  const binding = provider;
  const sessionId = localSessionId;
  if (
    !voiceGate ||
    localClientId === null ||
    !sessionId ||
    !binding
  ) {
    return null;
  }

  const peer = new VoicePeerConnection({
    localClientId,
    peerClientId,
    localSessionId: sessionId,
    peerSessionId,
    localTrack: voiceGate.outboundTrack,
    cameraTrack: localCameraTrack,
    screenTrack: localScreenTrack,
    sendSignal: (signal) => {
      if (
        provider === binding &&
        localSessionId === sessionId &&
        useVoiceStore.getState().status === 'joined'
      ) {
        binding.sendStateless(encodeVoiceSignal(signal));
      }
    },
    onRemoteStream: (stream) => {
      if (peerConnections.get(peerClientId) === peer) {
        useVoiceStore.getState().setRemote(peerClientId, stream);
      }
    },
    onRemoteVideoTrack: (kind, track) => {
      if (peerConnections.get(peerClientId) !== peer) return;
      // The track arrives at negotiation and stays for the connection's life;
      // whether the peer is actually publishing comes from their awareness.
      useVideoStore
        .getState()
        .setRemoteVideo(peerClientId, kind, new MediaStream([track]));
    },
    onConnectionStateChange: (state) => {
      if (peerConnections.get(peerClientId) !== peer) return;
      handlePeerConnectionState(peerClientId, peerSessionId, peer, state);
    },
  });
  peerConnections.set(peerClientId, peer);
  useVoiceStore.getState().setPeerStatus(peerClientId, 'connecting');
  armPeerTimeout(
    peerClientId,
    peer,
    peerSessionId,
    CONNECTING_PEER_TIMEOUT_MS,
  );
  void peer.start().catch((error: unknown) => {
    if (
      provider !== binding ||
      localSessionId !== sessionId ||
      peerConnections.get(peerClientId) !== peer
    ) {
      return;
    }
    markPeerFailed(peerClientId, peer, peerSessionId, error);
  });
  return peer;
}

function handlePeerConnectionState(
  peerClientId: number,
  peerSessionId: string,
  peer: VoicePeerConnection,
  state: RTCPeerConnectionState,
): void {
  if (state === 'connected') {
    clearPeerTimer(peerClientId);
    useVoiceStore.getState().setPeerStatus(peerClientId, 'connected');
    clearConnectionErrorIfRecovered();
    return;
  }
  if (state === 'failed') {
    markPeerFailed(
      peerClientId,
      peer,
      peerSessionId,
      new Error('Voice connection failed'),
    );
    return;
  }
  if (state === 'disconnected') {
    useVoiceStore.getState().setPeerStatus(peerClientId, 'disconnected');
    armPeerTimeout(
      peerClientId,
      peer,
      peerSessionId,
      DISCONNECTED_PEER_TIMEOUT_MS,
    );
    return;
  }
  if (state === 'connecting' || state === 'new') {
    useVoiceStore.getState().setPeerStatus(peerClientId, 'connecting');
  }
}

function markPeerFailed(
  peerClientId: number,
  peer: VoicePeerConnection,
  peerSessionId: string,
  error: unknown,
): void {
  if (peerConnections.get(peerClientId) !== peer) return;
  blockedPeerSessions.set(peerClientId, {
    sessionId: peerSessionId,
    reason: 'failed',
  });
  removePeer(peerClientId, true);
  useVoiceStore.getState().setPeerStatus(peerClientId, 'failed');
  useVoiceStore.getState().setError(errorMessage(error));
}

function removePeer(
  peerClientId: number,
  preserveStatus = false,
): void {
  clearPeerTimer(peerClientId);
  const peer = peerConnections.get(peerClientId);
  peerConnections.delete(peerClientId);
  peer?.close();
  useVoiceStore.getState().setRemote(peerClientId, null);
  useVideoStore.getState().setRemoteVideo(peerClientId, 'camera', null);
  useVideoStore.getState().setRemoteVideo(peerClientId, 'screen', null);
  if (!preserveStatus) {
    useVoiceStore.getState().setPeerStatus(peerClientId, null);
  }
}

/**
 * Fail a peer that never reaches `connected` within `timeoutMs`. An already
 * armed timer is kept, so the deadline runs from the first unhealthy state
 * rather than restarting on every state change.
 */
function armPeerTimeout(
  peerClientId: number,
  peer: VoicePeerConnection,
  peerSessionId: string,
  timeoutMs: number,
): void {
  if (peerTimers.has(peerClientId)) return;
  peerTimers.set(
    peerClientId,
    setTimeout(() => {
      peerTimers.delete(peerClientId);
      if (peerConnections.get(peerClientId) === peer) {
        markPeerFailed(
          peerClientId,
          peer,
          peerSessionId,
          new Error('Voice connection timed out'),
        );
      }
    }, timeoutMs),
  );
}

function clearPeerTimer(peerClientId: number): void {
  const timer = peerTimers.get(peerClientId);
  if (timer !== undefined) clearTimeout(timer);
  peerTimers.delete(peerClientId);
}

function clearAllPeerTimers(): void {
  peerTimers.forEach((timer) => clearTimeout(timer));
  peerTimers.clear();
}

function clearConnectionErrorIfRecovered(): void {
  const hasFailure = [...useVoiceStore.getState().peerStatuses.values()].some(
    (status) => status === 'failed',
  );
  if (!hasFailure) useVoiceStore.getState().setError(null);
}

function handleGateLevel({ levelDb, speaking }: VoiceGateLevel): void {
  const store = useVoiceStore.getState();
  if (store.status !== 'joined' && store.status !== 'testing') return;
  const audibleSpeaking =
    store.status === 'testing' ||
    (store.status === 'joined' && !store.muted)
      ? speaking
      : false;
  store.setInputLevel(levelDb, audibleSpeaking);
  if (
    store.status === 'joined' &&
    audibleSpeaking !== lastPublishedSpeaking
  ) {
    publishLocalVoice();
  }
}

function publishLocalVoice(): void {
  const store = useVoiceStore.getState();
  if (
    store.status !== 'joined' ||
    !localSessionId
  ) {
    return;
  }
  lastPublishedSpeaking = store.speaking;
  setLocalVoice({
    inCall: true,
    muted: store.muted,
    speaking: store.speaking,
    // Derived from the tracks, not the video store, so the two cannot drift.
    camera: localCameraTrack !== null,
    screen: localScreenTrack !== null,
    sessionId: localSessionId,
  });
}

function promoteVoiceTestToCall(clientId: number): void {
  if (
    useVoiceStore.getState().status !== 'testing' ||
    !localTrack ||
    !voiceGate
  ) {
    return;
  }

  localClientId = clientId;
  localSessionId = createVoiceSessionId();
  blockedPeerSessions.clear();
  clearAllPeerTimers();
  lastPublishedSpeaking = false;
  voiceGate.setMuted(true);
  useVoiceStore.getState().setMuted(true);
  useVoiceStore.getState().setInputLevel(
    useVoiceStore.getState().inputLevelDb,
    false,
  );
  useVoiceStore.getState().setStatus('joined');
  publishLocalVoice();
  reconcilePeers(usePresenceStore.getState().peers);
}

function isPendingJoinCurrent(
  generation: number,
  binding: VoiceSignalingProvider | null,
  clientId: number,
): boolean {
  return (
    generation === joinGeneration &&
    provider === binding &&
    binding?.awareness?.clientID === clientId
  );
}

function isPendingVoiceTestCurrent(
  generation: number,
  binding: VoiceSignalingProvider | null,
): boolean {
  return (
    generation === joinGeneration &&
    provider === binding &&
    useVoiceStore.getState().status === 'test-connecting'
  );
}

function isCurrentCapture(
  generation: number,
  binding: VoiceSignalingProvider | null,
): boolean {
  const status = useVoiceStore.getState().status;
  return (
    generation === joinGeneration &&
    provider === binding &&
    localTrack !== null &&
    voiceGate !== null &&
    (status === 'joined' || status === 'testing')
  );
}

function createVoiceSessionId(): string {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Voice connection failed';
}
