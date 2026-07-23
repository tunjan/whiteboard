import {
  encodeVoiceSignal,
  type VoiceSignal,
} from '@whiteboard/shared';
import { setLocalVoice } from '@/collab/presence';
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
import { useVoiceStore } from './use-voice-store';
import {
  createVoiceGate,
  type VoiceGate,
  type VoiceGateLevel,
} from './voice-gate';

const DISCONNECTED_PEER_TIMEOUT_MS = 10_000;

let provider: VoiceSignalingProvider | null = null;
let localClientId: number | null = null;
let localSessionId: string | null = null;
let localTrack: MediaStreamTrack | null = null;
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
const disconnectTimers = new Map<
  number,
  ReturnType<typeof setTimeout>
>();

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
    clearAllDisconnectTimers();
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
  for (const peerClientId of [...peerConnections.keys()]) {
    removePeer(peerClientId);
  }

  blockedPeerSessions.clear();
  clearAllDisconnectTimers();
  voiceGate?.stop();
  voiceGate = null;
  localTrack?.stop();
  localTrack = null;
  localClientId = null;
  localSessionId = null;
  lastPublishedSpeaking = false;
  noiseQueue = Promise.resolve();
  setLocalVoice(null);
  useVoiceStore.getState().resetSession();
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
  }
  useVoiceStore.getState().setError(null);
  reconcilePeers(usePresenceStore.getState().peers);
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

  const cleanup = () => {
    if (activeBindingCleanup !== cleanup) return;
    leaveVoice();
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
    onConnectionStateChange: (state) => {
      if (peerConnections.get(peerClientId) !== peer) return;
      handlePeerConnectionState(peerClientId, peerSessionId, peer, state);
    },
  });
  peerConnections.set(peerClientId, peer);
  useVoiceStore.getState().setPeerStatus(peerClientId, 'connecting');
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
    clearDisconnectTimer(peerClientId);
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
    if (!disconnectTimers.has(peerClientId)) {
      disconnectTimers.set(
        peerClientId,
        setTimeout(() => {
          disconnectTimers.delete(peerClientId);
          if (peerConnections.get(peerClientId) === peer) {
            markPeerFailed(
              peerClientId,
              peer,
              peerSessionId,
              new Error('Voice connection timed out'),
            );
          }
        }, DISCONNECTED_PEER_TIMEOUT_MS),
      );
    }
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
  clearDisconnectTimer(peerClientId);
  const peer = peerConnections.get(peerClientId);
  peerConnections.delete(peerClientId);
  peer?.close();
  useVoiceStore.getState().setRemote(peerClientId, null);
  if (!preserveStatus) {
    useVoiceStore.getState().setPeerStatus(peerClientId, null);
  }
}

function clearDisconnectTimer(peerClientId: number): void {
  const timer = disconnectTimers.get(peerClientId);
  if (timer !== undefined) clearTimeout(timer);
  disconnectTimers.delete(peerClientId);
}

function clearAllDisconnectTimers(): void {
  disconnectTimers.forEach((timer) => clearTimeout(timer));
  disconnectTimers.clear();
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
  clearAllDisconnectTimers();
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
