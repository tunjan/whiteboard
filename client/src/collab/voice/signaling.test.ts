import {
  VOICE_SIGNAL_PREFIX,
  decodeVoiceSignal,
  encodeVoiceSignal,
  type VoiceSignal,
} from '@whiteboard/shared';
import { describe, expect, it, vi } from 'vitest';
import { startVoiceSignaling } from './signaling';

const SESSION_A = 'session-a-123456';
const SESSION_B = 'session-b-123456';

function addressed(
  signal: { from: number; to: number } & (
    | { kind: 'offer' | 'answer'; sdp: string }
    | {
        kind: 'ice';
        candidate: {
          candidate: string;
          sdpMid?: string | null;
          sdpMLineIndex?: number | null;
        };
      }
    | { kind: 'bye' }
  ),
): VoiceSignal {
  return {
    ...signal,
    fromSessionId: SESSION_A,
    toSessionId: SESSION_B,
  } as VoiceSignal;
}

function makeProvider(clientId = 7) {
  const listeners = new Set<(event: { payload: string }) => void>();
  return {
    awareness: { clientID: clientId },
    on: vi.fn(
      (_event: string, listener: (event: { payload: string }) => void) => {
        listeners.add(listener);
      },
    ),
    off: vi.fn(
      (_event: string, listener: (event: { payload: string }) => void) => {
        listeners.delete(listener);
      },
    ),
    sendStateless: vi.fn(),
    emit: (signal: VoiceSignal) => {
      listeners.forEach((listener) =>
        listener({ payload: encodeVoiceSignal(signal) }),
      );
    },
  };
}

describe('voice signaling protocol', () => {
  it('round-trips every signal kind', () => {
    const signals: VoiceSignal[] = [
      addressed({ from: 1, to: 2, kind: 'offer', sdp: 'offer-sdp' }),
      addressed({ from: 2, to: 1, kind: 'answer', sdp: 'answer-sdp' }),
      addressed({
        from: 1,
        to: 2,
        kind: 'ice',
        candidate: {
          candidate: 'candidate:1',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      }),
      addressed({ from: 1, to: 2, kind: 'bye' }),
    ];

    for (const signal of signals) {
      expect(decodeVoiceSignal(encodeVoiceSignal(signal))).toEqual(signal);
    }
  });

  it('returns null for malformed or unrelated payloads', () => {
    expect(decodeVoiceSignal('whiteboard:latency:10')).toBeNull();
    expect(decodeVoiceSignal(`${VOICE_SIGNAL_PREFIX}{broken`)).toBeNull();
    expect(
      decodeVoiceSignal(
        `${VOICE_SIGNAL_PREFIX}${JSON.stringify({
          from: 'one',
          to: 2,
          fromSessionId: SESSION_A,
          toSessionId: SESSION_B,
          kind: 'bye',
        })}`,
      ),
    ).toBeNull();
  });

  it('delivers only signals addressed to this client from another client', () => {
    const provider = makeProvider();
    const onSignal = vi.fn();
    const stop = startVoiceSignaling(provider, onSignal);

    provider.emit(addressed({ from: 3, to: 7, kind: 'bye' }));
    provider.emit(addressed({ from: 3, to: 9, kind: 'bye' }));
    provider.emit(addressed({ from: 7, to: 7, kind: 'bye' }));

    expect(onSignal).toHaveBeenCalledTimes(1);
    expect(onSignal).toHaveBeenCalledWith({
      from: 3,
      to: 7,
      fromSessionId: SESSION_A,
      toSessionId: SESSION_B,
      kind: 'bye',
    });

    stop();
    provider.emit(addressed({ from: 3, to: 7, kind: 'bye' }));
    expect(onSignal).toHaveBeenCalledTimes(1);
  });
});
