import { encodeEphemeral, type EphemeralMessage } from '@whiteboard/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createEphemeralRelay,
  type EphemeralConnection,
  type EphemeralDocument,
} from './ephemeral-relay';

class FakeConnection implements EphemeralConnection {
  sendStateless = vi.fn();
}

function room() {
  const source = new FakeConnection();
  const peer = new FakeConnection();
  const other = new FakeConnection();
  const ownership = new Map<FakeConnection, Set<unknown>>([
    [source, new Set([1])],
    [peer, new Set([2])],
    [other, new Set([3])],
  ]);
  const document: EphemeralDocument<FakeConnection> = {
    getClients: (connection) => ownership.get(connection) ?? new Set(),
    getConnections: () => [source, peer, other],
  };
  return { source, peer, other, document };
}

const laser = (from: number): EphemeralMessage => ({
  from,
  kind: 'laser',
  ops: [{ op: 'add', id: 's1', at: 0, points: [0, 0, 10, 10] }],
});

describe('ephemeral relay', () => {
  it('forwards to every other connection, not back to the sender', () => {
    const { source, peer, other, document } = room();
    const payload = encodeEphemeral(laser(1));
    const relay = createEphemeralRelay();

    expect(relay({ connection: source, document, payload })).toBe('relayed');
    expect(peer.sendStateless).toHaveBeenCalledWith(payload);
    expect(other.sendStateless).toHaveBeenCalledWith(payload);
    expect(source.sendStateless).not.toHaveBeenCalled();
  });

  it('rejects a message naming a client the sender does not own', () => {
    const { source, peer, document } = room();
    const relay = createEphemeralRelay();

    const payload = encodeEphemeral(laser(2));
    expect(relay({ connection: source, document, payload })).toBe('rejected');
    expect(peer.sendStateless).not.toHaveBeenCalled();
  });

  it('rejects malformed bodies and ignores other prefixes', () => {
    const { source, document } = room();
    const relay = createEphemeralRelay();

    const bad = encodeEphemeral({
      from: 1,
      kind: 'laser',
      ops: [{ op: 'add', id: 's1', at: 0, points: [0, 0, 1] }],
    });
    expect(relay({ connection: source, document, payload: bad })).toBe(
      'rejected',
    );
    expect(
      relay({ connection: source, document, payload: 'whiteboard:voice:{}' }),
    ).toBe('ignored');
  });

  it('rate-limits a flooding connection', () => {
    const { source, document } = room();
    const relay = createEphemeralRelay();
    const payload = encodeEphemeral(laser(1));

    let last = '';
    for (let i = 0; i < 1_001; i++) {
      last = relay({ connection: source, document, payload, now: 0 });
    }
    expect(last).toBe('rejected');
    expect(relay({ connection: source, document, payload, now: 10_000 })).toBe(
      'relayed',
    );
  });
});
