import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeEphemeral,
  encodeEphemeral,
  type EphemeralMessage,
} from '@whiteboard/shared';
import {
  type EphemeralChannel,
  restoreLocalPresence,
  setActiveAwareness,
  setLocalCursor,
  setLocalCursorType,
  setLocalEraserScribbles,
  setLocalLaser,
  setLocalPage,
  setLocalUser,
  setLocalVoice,
} from './presence';
import { usePresenceStore } from './use-presence-store';
import type { EraserScribble } from '@/canvas/use-eraser-trail-store';
import { useEraserStore } from '@/canvas/use-eraser-store';

const awarenessInstances: Awareness[] = [];

/** A stateless channel that records what is sent and delivers what a peer sends. */
function makeChannel() {
  const listeners = new Set<(event: { payload: string }) => void>();
  const sent: string[] = [];
  const channel: EphemeralChannel = {
    on: (_event, listener) => listeners.add(listener),
    off: (_event, listener) => listeners.delete(listener),
    sendStateless: (payload) => sent.push(payload),
  };
  const deliver = (payload: string) => {
    for (const listener of listeners) listener({ payload });
  };
  const messages = () =>
    sent.map((payload) => decodeEphemeral(payload) as EphemeralMessage);
  return { channel, sent, deliver, messages };
}

/** A remote peer known to `local`'s awareness, with a user name. */
function joinPeer(local: Awareness): Awareness {
  const remote = makeAwareness();
  remote.setLocalStateField('user', {
    name: 'Student',
    color: '#2f6df6',
    isTutor: false,
  });
  applyAwarenessUpdate(
    local,
    encodeAwarenessUpdate(remote, [remote.clientID]),
    remote,
  );
  return remote;
}

function makeAwareness(): Awareness {
  const instance = new Awareness(new Y.Doc());
  awarenessInstances.push(instance);
  return instance;
}

afterEach(() => {
  vi.useRealTimers();
  setLocalCursorType('pointer');
  setActiveAwareness(null);
  awarenessInstances.forEach((instance) => {
    instance.destroy();
    instance.doc.destroy();
  });
  awarenessInstances.length = 0;
});

describe('collaborator latency presence', () => {
  it('publishes a remote user latency into the peer store', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Student',
      color: '#2f6df6',
      isTutor: false,
    });
    remote.setLocalStateField('latencyMs', 87);

    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );

    expect(usePresenceStore.getState().peers).toEqual([
      expect.objectContaining({ name: 'Student', latencyMs: 87 }),
    ]);
  });
});

describe('collaborator voice presence', () => {
  it('publishes voice changes and replaces the cached peer object', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Student',
      color: '#2f6df6',
      isTutor: false,
    });
    remote.setLocalStateField('voice', {
      inCall: true,
      muted: true,
      speaking: false,
      camera: false,
      screen: false,
      sessionId: 'remote-session-1234',
    });

    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    const mutedPeer = usePresenceStore.getState().peers[0];
    expect(mutedPeer?.voice).toEqual({
      inCall: true,
      muted: true,
      speaking: false,
      camera: false,
      screen: false,
      sessionId: 'remote-session-1234',
    });

    remote.setLocalStateField('cursor', { x: 10, y: 20 });
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    expect(usePresenceStore.getState().peers[0]).not.toBe(mutedPeer);
    expect(usePresenceStore.getState().peers[0]?.voice).toBe(mutedPeer?.voice);

    remote.setLocalStateField('voice', {
      inCall: true,
      muted: false,
      speaking: true,
      camera: false,
      screen: false,
      sessionId: 'remote-session-1234',
    });
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    const speakingPeer = usePresenceStore.getState().peers[0];

    expect(speakingPeer).not.toBe(mutedPeer);
    expect(speakingPeer?.voice).toEqual({
      inCall: true,
      muted: false,
      speaking: true,
      camera: false,
      screen: false,
      sessionId: 'remote-session-1234',
    });
  });

  it('replaces the cached peer object when only the camera flag flips', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Student',
      color: '#2f6df6',
      isTutor: false,
    });
    const base = {
      inCall: true,
      muted: true,
      speaking: false,
      camera: false,
      screen: false,
      sessionId: 'remote-session-1234',
    };
    remote.setLocalStateField('voice', base);
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    const before = usePresenceStore.getState().peers[0];

    // Re-publishing the same values must not churn the cached peer object.
    remote.setLocalStateField('voice', { ...base });
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    expect(usePresenceStore.getState().peers[0]).toBe(before);

    remote.setLocalStateField('voice', { ...base, camera: true });
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    const after = usePresenceStore.getState().peers[0];

    expect(after).not.toBe(before);
    expect(after?.voice?.camera).toBe(true);
  });

  it('normalizes voice awareness that predates the camera and screen fields', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Stale tab',
      color: '#2f6df6',
      isTutor: false,
    });
    remote.setLocalStateField('voice', {
      inCall: true,
      muted: true,
      speaking: false,
      sessionId: 'remote-session-1234',
    });

    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );

    expect(usePresenceStore.getState().peers[0]?.voice).toBeNull();
  });

  it('normalizes malformed voice awareness to no voice membership', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Legacy client',
      color: '#2f6df6',
      isTutor: false,
    });
    remote.setLocalStateField('voice', {
      inCall: 'false',
      muted: 'false',
      speaking: 'false',
      sessionId: 'legacy-session-123',
    });

    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );

    expect(usePresenceStore.getState().peers[0]?.voice).toBeNull();
  });
});

describe('local presence after a page-hide wipe', () => {
  const voice = {
    inCall: true as const,
    muted: false,
    speaking: false,
    camera: false,
    screen: false,
    sessionId: 'local-session-1234',
  };

  it('republishes sticky local fields when the page is restored', () => {
    const local = makeAwareness();
    setActiveAwareness(local);
    setLocalUser({ name: 'Tutor', color: '#2f6df6', isTutor: true });
    setLocalPage('page-2');
    setLocalVoice(voice);

    // What the provider does on `pagehide`.
    removeAwarenessStates(local, [local.clientID], 'page hide');
    expect(local.getLocalState()).toBeNull();

    restoreLocalPresence();

    expect(local.getLocalState()).toMatchObject({
      user: { name: 'Tutor', color: '#2f6df6', isTutor: true },
      page: 'page-2',
      voice,
    });
  });

  it('keeps publishing local updates after the page is restored', () => {
    const local = makeAwareness();
    setActiveAwareness(local);
    setLocalUser({ name: 'Tutor', color: '#2f6df6', isTutor: true });

    removeAwarenessStates(local, [local.clientID], 'page hide');
    // yjs silently ignores field writes while the local state is null, which is
    // what left a restored tab invisible to its peers.
    setLocalVoice(voice);
    expect(local.getLocalState()).toBeNull();

    restoreLocalPresence();
    setLocalVoice({ ...voice, muted: true });

    expect(local.getLocalState()?.voice).toEqual({ ...voice, muted: true });
  });

  it('leaves a live local state untouched', () => {
    const local = makeAwareness();
    setActiveAwareness(local);
    setLocalUser({ name: 'Tutor', color: '#2f6df6', isTutor: true });
    const before = local.getLocalState();

    restoreLocalPresence();

    expect(local.getLocalState()).toBe(before);
  });
});

const eraserScribble: EraserScribble = {
  id: 'erase-1',
  points: [
    { x: 10, y: 20, pressure: 0.5 },
    { x: 30, y: 40, pressure: 0.5 },
  ],
  state: 'active',
  color: 'muted-1',
  size: 12,
  opacity: 0.5,
  taper: true,
};

describe('collaborator eraser presence', () => {
  it('publishes a peer trail', () => {
    const local = makeAwareness();
    const { channel, deliver } = makeChannel();
    setActiveAwareness(local, channel);
    const remote = joinPeer(local);

    deliver(
      encodeEphemeral({
        from: remote.clientID,
        kind: 'scribbles',
        scribbles: [
          {
            id: 'erase-1',
            points: [10, 20, 0.5, 30, 40, 0.5],
            state: 'active',
            size: 12,
          },
        ],
      }),
    );

    expect(usePresenceStore.getState().peers).toEqual([
      expect.objectContaining({ scribbles: [eraserScribble] }),
    ]);
  });

  it('reads a peer without an active eraser trail as null', () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    remote.setLocalStateField('user', {
      name: 'Student',
      color: '#2f6df6',
      isTutor: false,
    });

    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );

    expect(usePresenceStore.getState().peers[0]!.scribbles).toBeNull();
  });

  it('sends the first scribble sample immediately, outside awareness', () => {
    const local = makeAwareness();
    const { channel, messages } = makeChannel();
    setActiveAwareness(local, channel);

    setLocalEraserScribbles([eraserScribble]);

    expect(messages()).toEqual([
      expect.objectContaining({
        kind: 'scribbles',
        scribbles: [
          expect.objectContaining({
            id: 'erase-1',
            points: [10, 20, 0.5, 30, 40, 0.5],
          }),
        ],
      }),
    ]);
    expect(local.getLocalState()?.scribbles).toBeUndefined();
    expect(local.getLocalState()?.erasing ?? null).toBeNull();
  });

  it('flushes the clear that ends a scribble even when it is throttled', async () => {
    const local = makeAwareness();
    const { channel, messages } = makeChannel();
    setActiveAwareness(local, channel);

    setLocalEraserScribbles([eraserScribble]);
    // Straight after the first send, so this one can only go out on the
    // trailing timer — the case where a lost clear would strand a peer trail.
    setLocalEraserScribbles([]);

    expect(messages()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(messages()[1]).toEqual(
      expect.objectContaining({ kind: 'scribbles', scribbles: [] }),
    );
  });

  it("drops a peer's trail when the peer leaves", () => {
    const local = makeAwareness();
    const { channel, deliver } = makeChannel();
    setActiveAwareness(local, channel);
    const remote = joinPeer(local);
    deliver(
      `whiteboard:fx:${JSON.stringify({
        from: remote.clientID,
        kind: 'scribbles',
        scribbles: [
          { id: 'e', points: [0, 0, 0.5], state: 'active', size: 12 },
        ],
      })}`,
    );
    expect(usePresenceStore.getState().peers[0]!.scribbles).toHaveLength(1);

    removeAwarenessStates(local, [remote.clientID], 'test');
    // Rejoining must not bring the old trail back.
    remote.setLocalStateField('page', 'p1');
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    const peer = usePresenceStore
      .getState()
      .peers.find((p) => p.clientId === remote.clientID);
    expect(peer?.scribbles).toBeNull();
  });

  it("fades a peer's pending erase targets until they release", () => {
    const local = makeAwareness();
    const remote = makeAwareness();
    setActiveAwareness(local);
    const sync = () =>
      applyAwarenessUpdate(
        local,
        encodeAwarenessUpdate(remote, [remote.clientID]),
        remote,
      );
    remote.setLocalStateField('user', {
      name: 'Student',
      color: '#2f6df6',
      isTutor: false,
    });
    remote.setLocalStateField('erasing', ['a', 'b']);
    sync();

    expect(useEraserStore.getState().isMarked('a')).toBe(true);
    expect(useEraserStore.getState().isMarked('b')).toBe(true);

    remote.setLocalStateField('erasing', null);
    sync();

    expect(useEraserStore.getState().marked).toEqual({});
  });

  it('publishes the local erase queue and sends its clear at once', () => {
    const local = makeAwareness();
    setActiveAwareness(local);

    useEraserStore.getState().set(['a']);
    expect(local.getLocalState()?.erasing).toEqual(['a']);

    // Inside the throttle window, yet the clear must not wait for a timer.
    useEraserStore.getState().clear();
    expect(local.getLocalState()?.erasing).toBeNull();
  });

  it('carries the eraser crosshair independently from cursor coordinates', () => {
    const local = makeAwareness();
    setActiveAwareness(local);

    setLocalCursorType('cross');

    expect(local.getLocalState()?.cursorType).toBe('cross');
  });

  it('publishes the cursor at 5 Hz, landing where the pointer rests', async () => {
    const local = makeAwareness();
    setActiveAwareness(local);
    // Leaving goes out at once, and starts a fresh throttle window.
    setLocalCursor(null);
    expect(local.getLocalState()?.cursor ?? null).toBeNull();

    setLocalCursor({ x: 1, y: 1 });
    setLocalCursor({ x: 2, y: 2 });
    setLocalCursor({ x: 3, y: 3 });
    // Inside the window: only the trailing send can carry the resting point.
    expect(local.getLocalState()?.cursor ?? null).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(local.getLocalState()?.cursor).toEqual({ x: 3, y: 3 });

    setLocalCursor({ x: 4, y: 4 });
    setLocalCursor(null);
    expect(local.getLocalState()?.cursor ?? null).toBeNull();
    // The cancelled trailing send must not resurrect the cursor.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(local.getLocalState()?.cursor ?? null).toBeNull();
  });
});

describe('collaborator laser presence', () => {
  const point = (i: number) => ({ x: i, y: i * 2 });

  /** Draw one laser stroke of `n` points, one pointer move per throttle window. */
  function drawStroke(n: number) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const local = makeAwareness();
    const out = makeChannel();
    setActiveAwareness(local, out.channel);
    const points = [];
    for (let i = 0; i < n; i++) {
      points.push(point(i));
      setLocalLaser([{ id: 'l1', points: [...points], done: false }]);
      vi.advanceTimersByTime(40);
    }
    return { local, out, points };
  }

  it('sends each point once, not the whole stroke every time', () => {
    const { out, local } = drawStroke(200);

    const adds = out
      .messages()
      .flatMap((m) => (m.kind === 'laser' ? m.ops : []))
      .filter((op) => op.op === 'add');
    expect(adds.reduce((sum, op) => sum + op.points.length, 0)).toBe(400);
    expect(adds.map((op) => op.at)).toEqual(adds.map((_, i) => i));
    expect(local.getLocalState()?.laser).toBeUndefined();

    // Re-sending the whole stroke each time, as awareness did, grows with the
    // square of its length; the deltas stay a small multiple of one copy.
    const total = out.sent.reduce((sum, p) => sum + p.length, 0);
    const oneCopy = JSON.stringify(
      Array.from({ length: 200 }, (_, i) => point(i)),
    ).length;
    expect(total / oneCopy).toBeLessThan(15);
  });

  it('rebuilds a peer stroke from deltas, then fades and drops it', () => {
    const { out } = drawStroke(5);
    setLocalLaser([
      {
        id: 'l1',
        points: Array.from({ length: 5 }, (_, i) => point(i)),
        done: true,
      },
    ]);
    vi.advanceTimersByTime(40);
    setLocalLaser([]);
    vi.advanceTimersByTime(40);

    const local = makeAwareness();
    const { channel, deliver } = makeChannel();
    setActiveAwareness(local, channel);
    const remote = joinPeer(local);
    const from = out.messages()[0]!.from;
    const relabel = (payload: string) =>
      payload.replace(`"from":${from}`, `"from":${remote.clientID}`);
    const laser = () =>
      usePresenceStore
        .getState()
        .peers.find((p) => p.clientId === remote.clientID)?.laser;

    const payloads = out.sent.map(relabel);
    const [last, beforeLast, ...rest] = [...payloads].reverse();
    for (const payload of rest.reverse()) deliver(payload);
    // A duplicated delta must not double the stroke.
    deliver(payloads[1]!);
    expect(laser()).toEqual([
      {
        id: 'l1',
        points: Array.from({ length: 5 }, (_, i) => point(i)),
        done: false,
      },
    ]);
    deliver(beforeLast!);
    expect(laser()?.[0]?.done).toBe(true);
    deliver(last!);
    expect(laser()).toBeNull();
  });

  it('re-sends strokes whole on a new connection', () => {
    const { out } = drawStroke(3);
    const next = makeChannel();
    setActiveAwareness(makeAwareness(), next.channel);
    setLocalLaser([
      {
        id: 'l1',
        points: [point(0), point(1), point(2), point(3)],
        done: false,
      },
    ]);
    expect(out.sent.length).toBeGreaterThan(0);
    expect(next.messages()[0]).toEqual(
      expect.objectContaining({
        ops: [{ op: 'add', id: 'l1', at: 0, points: [0, 0, 1, 2, 2, 4, 3, 6] }],
      }),
    );
  });
});
