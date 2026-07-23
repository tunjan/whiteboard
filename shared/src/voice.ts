/** Prefix for peer-to-peer voice signaling over the collaboration socket. */
export const VOICE_SIGNAL_PREFIX = 'whiteboard:voice:';
export const MAX_VOICE_SIGNAL_LENGTH = 65_536;
export const MAX_VOICE_SDP_LENGTH = 32_768;
export const MAX_VOICE_ICE_CANDIDATE_LENGTH = 4_096;
export const MAX_VOICE_SESSION_ID_LENGTH = 128;

export interface VoicePresence {
  inCall: boolean;
  muted: boolean;
  speaking: boolean;
  sessionId: string;
}

/**
 * Runtime-neutral subset of RTCIceCandidateInit. The shared package is also
 * compiled by the Node server, where DOM WebRTC types are not available.
 */
export interface VoiceIceCandidate {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type VoiceSignal = {
  from: number;
  to: number;
  fromSessionId: string;
  toSessionId: string;
} & (
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: VoiceIceCandidate }
  | { kind: 'bye' }
);

export function encodeVoiceSignal(signal: VoiceSignal): string {
  return `${VOICE_SIGNAL_PREFIX}${JSON.stringify(signal)}`;
}

export function decodeVoiceSignal(payload: string): VoiceSignal | null {
  if (
    payload.length > MAX_VOICE_SIGNAL_LENGTH ||
    !payload.startsWith(VOICE_SIGNAL_PREFIX)
  ) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(
      payload.slice(VOICE_SIGNAL_PREFIX.length),
    );
    if (
      !isRecord(value) ||
      !isClientId(value.from) ||
      !isClientId(value.to) ||
      value.from === value.to ||
      !isVoiceSessionId(value.fromSessionId) ||
      !isVoiceSessionId(value.toSessionId)
    ) {
      return null;
    }

    const addressing = {
      from: value.from,
      to: value.to,
      fromSessionId: value.fromSessionId,
      toSessionId: value.toSessionId,
    };

    if (value.kind === 'bye') {
      return { ...addressing, kind: 'bye' };
    }

    if (
      (value.kind === 'offer' || value.kind === 'answer') &&
      typeof value.sdp === 'string' &&
      value.sdp.length <= MAX_VOICE_SDP_LENGTH
    ) {
      return {
        ...addressing,
        kind: value.kind,
        sdp: value.sdp,
      };
    }

    if (value.kind === 'ice' && isIceCandidate(value.candidate)) {
      return {
        ...addressing,
        kind: 'ice',
        candidate: value.candidate,
      };
    }
  } catch {
    // Stateless messages share one channel; malformed/non-voice payloads are
    // intentionally ignored rather than surfacing an application error.
  }

  return null;
}

export function parseVoicePresence(value: unknown): VoicePresence | null {
  if (
    !isRecord(value) ||
    value.inCall !== true ||
    typeof value.muted !== 'boolean' ||
    typeof value.speaking !== 'boolean' ||
    !isVoiceSessionId(value.sessionId)
  ) {
    return null;
  }
  // Preserve the awareness field's object identity so cursor-only updates can
  // reuse cached peer objects and avoid waking voice UI subscribers.
  return value as unknown as VoicePresence;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isClientId(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 0xffffffff
  );
}

function isVoiceSessionId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 16 &&
    value.length <= MAX_VOICE_SESSION_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function isOptionalNullableString(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === 'string' && value.length <= 256)
  );
}

function isIceCandidate(value: unknown): value is VoiceIceCandidate {
  if (
    !isRecord(value) ||
    typeof value.candidate !== 'string' ||
    value.candidate.length > MAX_VOICE_ICE_CANDIDATE_LENGTH
  ) {
    return false;
  }
  if (!isOptionalNullableString(value.sdpMid)) return false;
  if (
    value.sdpMLineIndex !== undefined &&
    value.sdpMLineIndex !== null &&
    (typeof value.sdpMLineIndex !== 'number' ||
      !Number.isInteger(value.sdpMLineIndex) ||
      value.sdpMLineIndex < 0)
  ) {
    return false;
  }
  return isOptionalNullableString(value.usernameFragment);
}
