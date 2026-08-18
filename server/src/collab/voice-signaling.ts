import {
  MAX_VOICE_SIGNAL_LENGTH,
  decodeVoiceSignal,
  parseVoicePresence,
} from '@whiteboard/shared';

const VOICE_SIGNAL_RATE_WINDOW_MS = 10_000;
const MAX_VOICE_SIGNALS_PER_WINDOW = 256;

export interface VoiceSignalConnection {
  sendStateless: (payload: string) => void;
}

export interface VoiceSignalDocument<
  Connection extends VoiceSignalConnection,
> {
  awareness: {
    getStates: () => Map<number, Record<string, unknown>>;
  };
  getClients: (connection: Connection) => Set<unknown>;
  getConnections: () => Connection[];
}

export type VoiceSignalRouteResult = 'ignored' | 'rejected' | 'routed';

interface RateWindow {
  startedAt: number;
  count: number;
}

export function sanitizeVoiceAwareness<
  Connection extends VoiceSignalConnection,
>({
  connection,
  document,
  states,
}: {
  connection: Connection;
  document: Pick<
    VoiceSignalDocument<Connection>,
    'awareness' | 'getClients' | 'getConnections'
  >;
  states: Map<number, Record<string, unknown>>;
}): void {
  const currentClientIds = document.awareness.getStates();
  const connectedClientIds = new Set(
    document
      .getConnections()
      .flatMap((candidate) => [...document.getClients(candidate)]),
  );

  // Hocuspocus builds hook input with a temporary Awareness instance. Yjs
  // gives that instance an empty local state, which is not part of the
  // incoming update. Remove only unknown empty ids so the synthetic state
  // cannot be mistaken for a second identity.
  for (const [clientId, state] of states) {
    if (
      Object.keys(state).length === 0 &&
      !currentClientIds.has(clientId) &&
      !connectedClientIds.has(clientId)
    ) {
      states.delete(clientId);
    }
  }

  const ownedClientIds = document.getClients(connection);
  const incomingClientIds = [...states.keys()];

  // One provider/document connection owns one awareness client id. Reject
  // attempts to add more identities or take an id already owned elsewhere.
  if (ownedClientIds.size === 0 && incomingClientIds.length > 1) {
    states.clear();
    return;
  }
  for (const clientId of incomingClientIds) {
    const ownedElsewhere = document
      .getConnections()
      .some(
        (candidate) =>
          candidate !== connection &&
          document.getClients(candidate).has(clientId),
      );
    if (
      ownedElsewhere ||
      (ownedClientIds.size > 0 && !ownedClientIds.has(clientId))
    ) {
      states.delete(clientId);
      continue;
    }

    const state = states.get(clientId);
    if (state && Object.hasOwn(state, 'voice')) {
      const voice = parseVoicePresence(state.voice);
      state.voice = voice
        ? {
            inCall: true,
            muted: voice.muted,
            speaking: voice.speaking,
            sessionId: voice.sessionId,
            camera: voice.camera,
            screen: voice.screen,
          }
        : null;
    }
  }
}

/** Create an isolated router so rate-limit state cannot leak between servers/tests. */
export function createVoiceSignalRouter() {
  const rateWindows = new WeakMap<object, RateWindow>();

  return function routeVoiceSignal<
    Connection extends VoiceSignalConnection,
  >({
    connection,
    document,
    payload,
    now = Date.now(),
  }: {
    connection: Connection;
    document: VoiceSignalDocument<Connection>;
    payload: string;
    now?: number;
  }): VoiceSignalRouteResult {
    if (!payload.startsWith('whiteboard:voice:')) return 'ignored';
    if (Buffer.byteLength(payload, 'utf8') > MAX_VOICE_SIGNAL_LENGTH) {
      return 'rejected';
    }

    const currentWindow = rateWindows.get(connection);
    const rateWindow =
      !currentWindow ||
      now - currentWindow.startedAt >= VOICE_SIGNAL_RATE_WINDOW_MS
        ? { startedAt: now, count: 0 }
        : currentWindow;
    rateWindow.count += 1;
    rateWindows.set(connection, rateWindow);
    if (rateWindow.count > MAX_VOICE_SIGNALS_PER_WINDOW) return 'rejected';

    const signal = decodeVoiceSignal(payload);
    if (!signal || !document.getClients(connection).has(signal.from)) {
      return 'rejected';
    }

    const states = document.awareness.getStates();
    const sourceVoice = parseVoicePresence(states.get(signal.from)?.voice);
    const targetVoice = parseVoicePresence(states.get(signal.to)?.voice);
    if (
      !sourceVoice ||
      !targetVoice ||
      sourceVoice.sessionId !== signal.fromSessionId ||
      targetVoice.sessionId !== signal.toSessionId
    ) {
      return 'rejected';
    }

    const targets = document
      .getConnections()
      .filter(
        (candidate) =>
          candidate !== connection &&
          document.getClients(candidate).has(signal.to),
      );
    if (targets.length !== 1) return 'rejected';

    targets[0]!.sendStateless(payload);
    return 'routed';
  };
}
