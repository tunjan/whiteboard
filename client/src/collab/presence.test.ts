import * as Y from 'yjs';
import {
  Awareness,
  applyAwarenessUpdate,
  encodeAwarenessUpdate,
  removeAwarenessStates,
} from 'y-protocols/awareness';
import { afterEach, describe, expect, it } from 'vitest';
import {
  restoreLocalPresence,
  setActiveAwareness,
  setLocalPage,
  setLocalUser,
  setLocalVoice,
} from './presence';
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
    expect(usePresenceStore.getState().peers[0]?.voice).toBe(
      mutedPeer?.voice,
    );

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
