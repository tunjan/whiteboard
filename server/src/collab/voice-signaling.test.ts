import {
  MAX_VOICE_SIGNAL_LENGTH,
  encodeVoiceSignal,
  type VoicePresence,
  type VoiceSignal,
} from '@whiteboard/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceSignalRouter,
  sanitizeVoiceAwareness,
  type VoiceSignalConnection,
  type VoiceSignalDocument,
} from './voice-signaling';

const SOURCE_SESSION = 'source-session-1234';
const TARGET_SESSION = 'target-session-1234';

class FakeConnection implements VoiceSignalConnection {
  sendStateless = vi.fn();
}

function voice(
  sessionId: string,
  overrides: Partial<VoicePresence> = {},
): VoicePresence {
  return {
    inCall: true,
    muted: true,
    speaking: false,
    camera: false,
    screen: false,
    sessionId,
    ...overrides,
  };
}

function signal(overrides: Partial<VoiceSignal> = {}): VoiceSignal {
  return {
    from: 1,
    to: 2,
    fromSessionId: SOURCE_SESSION,
    toSessionId: TARGET_SESSION,
    kind: 'bye',
    ...overrides,
  } as VoiceSignal;
}

function room() {
  const source = new FakeConnection();
  const target = new FakeConnection();
  const observer = new FakeConnection();
  const ownership = new Map<FakeConnection, Set<unknown>>([
    [source, new Set([1])],
    [target, new Set([2])],
    [observer, new Set([3])],
  ]);
  const states = new Map<number, Record<string, unknown>>([
    [1, { voice: voice(SOURCE_SESSION) }],
    [2, { voice: voice(TARGET_SESSION) }],
    [3, { voice: null }],
  ]);
  const document: VoiceSignalDocument<FakeConnection> = {
    awareness: { getStates: () => states },
    getClients: (connection) => ownership.get(connection) ?? new Set(),
    getConnections: () => [source, target, observer],
  };
  return { source, target, observer, ownership, states, document };
}

describe('voice signaling router', () => {
  it('routes a valid signal only to its authenticated target', () => {
    const { source, target, observer, document } = room();
    const payload = encodeVoiceSignal(signal());
    const route = createVoiceSignalRouter();

    expect(route({ connection: source, document, payload })).toBe('routed');
    expect(target.sendStateless).toHaveBeenCalledWith(payload);
    expect(observer.sendStateless).not.toHaveBeenCalled();
    expect(source.sendStateless).not.toHaveBeenCalled();
  });

  it('rejects forged senders and stale or absent voice sessions', () => {
    const { source, target, ownership, states, document } = room();
    const route = createVoiceSignalRouter();

    ownership.set(source, new Set([9]));
    expect(
      route({
        connection: source,
        document,
        payload: encodeVoiceSignal(signal()),
      }),
    ).toBe('rejected');

    ownership.set(source, new Set([1]));
    expect(
      route({
        connection: source,
        document,
        payload: encodeVoiceSignal(
          signal({ fromSessionId: 'stale-session-123' }),
        ),
      }),
    ).toBe('rejected');

    states.set(1, { voice: null });
    expect(
      route({
        connection: source,
        document,
        payload: encodeVoiceSignal(signal()),
      }),
    ).toBe('rejected');
    expect(target.sendStateless).not.toHaveBeenCalled();
  });

  it('bounds voice payload size and per-connection message rate', () => {
    const { source, document } = room();
    const route = createVoiceSignalRouter();
    const payload = encodeVoiceSignal(signal());

    for (let index = 0; index < 256; index += 1) {
      expect(
        route({ connection: source, document, payload, now: 1_000 }),
      ).toBe('routed');
    }
    expect(
      route({ connection: source, document, payload, now: 1_000 }),
    ).toBe('rejected');

    const nextRoute = createVoiceSignalRouter();
    expect(
      nextRoute({
        connection: source,
        document,
        payload: `whiteboard:voice:${'x'.repeat(MAX_VOICE_SIGNAL_LENGTH)}`,
      }),
    ).toBe('rejected');
  });
});

describe('voice awareness ownership', () => {
  it('normalizes voice data for the connection-owned awareness id', () => {
    const { source, document } = room();
    const states = new Map<number, Record<string, unknown>>([
      [999, {}],
      [
        1,
        {
          voice: {
            ...voice(SOURCE_SESSION),
            ignored: 'not broadcast',
          },
        },
      ],
    ]);

    sanitizeVoiceAwareness({ connection: source, document, states });

    expect(states.has(999)).toBe(false);
    expect(states.get(1)?.voice).toEqual(voice(SOURCE_SESSION));
  });

  it('preserves camera and screen through the rewrite', () => {
    const { source, document } = room();
    const states = new Map<number, Record<string, unknown>>([
      [
        1,
        { voice: voice(SOURCE_SESSION, { camera: true, screen: true }) },
      ],
    ]);

    sanitizeVoiceAwareness({ connection: source, document, states });

    expect(states.get(1)?.voice).toEqual(
      voice(SOURCE_SESSION, { camera: true, screen: true }),
    );
  });

  it('nulls voice presence that predates the camera and screen fields', () => {
    const { source, document } = room();
    const { camera, screen, ...legacy } = voice(SOURCE_SESSION);
    const states = new Map<number, Record<string, unknown>>([
      [1, { voice: legacy }],
    ]);

    sanitizeVoiceAwareness({ connection: source, document, states });

    expect(states.get(1)?.voice).toBeNull();
  });

  it('drops awareness ids owned by another connection or extra local ids', () => {
    const { source, ownership, document } = room();
    const stolen = new Map<number, Record<string, unknown>>([
      [2, { voice: voice(SOURCE_SESSION) }],
    ]);
    sanitizeVoiceAwareness({
      connection: source,
      document,
      states: stolen,
    });
    expect(stolen.size).toBe(0);

    ownership.set(source, new Set());
    const multiple = new Map<number, Record<string, unknown>>([
      [10, {}],
      [11, {}],
    ]);
    sanitizeVoiceAwareness({
      connection: source,
      document,
      states: multiple,
    });
    expect(multiple.size).toBe(0);
  });
});
