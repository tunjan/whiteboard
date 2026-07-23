import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
} from 'y-protocols/awareness';
import { afterEach, describe, expect, it } from 'vitest';
import { setActiveAwareness } from './presence';
import { usePresenceStore } from './use-presence-store';

const awarenessInstances: Awareness[] = [];

function makeAwareness(): Awareness {
  const instance = new Awareness(new Y.Doc());
  awarenessInstances.push(instance);
  return instance;
}

afterEach(() => {
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
      sessionId: 'remote-session-1234',
    });

    remote.setLocalStateField('cursor', { x: 10, y: 20 });
    applyAwarenessUpdate(
      local,
      encodeAwarenessUpdate(remote, [remote.clientID]),
      remote,
    );
    expect(usePresenceStore.getState().peers[0]).not.toBe(mutedPeer);
    expect(usePresenceStore.getState().peers[0]?.voice).toBe(
      mutedPeer?.voice,
    );

    remote.setLocalStateField('voice', {
      inCall: true,
      muted: false,
      speaking: true,
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
      sessionId: 'remote-session-1234',
    });
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
