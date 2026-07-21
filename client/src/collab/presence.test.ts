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
