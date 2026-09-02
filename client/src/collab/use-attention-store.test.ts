import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const local = vi.hoisted(() => ({ isTutor: true }));

// `presence.ts` reaches into the document store (and so into yjs) for its page
// switching; only `getLocalUser` matters here.
vi.mock('./presence', () => ({
  getLocalUser: () => ({
    name: 'Tutor',
    color: '#000',
    isTutor: local.isTutor,
  }),
}));

import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { useAttentionStore } from './use-attention-store';
import { usePresenceStore, type PeerPresence } from './use-presence-store';
import type { AttentionPresence } from './attention-state';

function peer(
  clientId: number,
  attention: AttentionPresence | null,
  isTutor = false,
): PeerPresence {
  return {
    clientId,
    name: `Peer ${clientId}`,
    color: '#123456',
    isTutor,
    cursor: null,
    viewport: null,
    summon: null,
    page: null,
    following: false,
    latencyMs: null,
    textSelection: null,
    selection: null,
    erasing: null,
    laser: null,
    voice: null,
    attention,
  };
}

/** Push a peer list and let the store's ticker run for `seconds`. */
function advance(peers: PeerPresence[], seconds: number): void {
  usePresenceStore.setState({ peers });
  vi.advanceTimersByTime(seconds * 1_000);
}

function stateOf(clientId: number): string | undefined {
  return useAttentionStore.getState().peers.get(clientId)?.state;
}

describe('useAttentionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    local.isTutor = true;
    useCanvasUiStore.setState({
      attentionAlertsEnabled: true,
      attentionIdleSeconds: 90,
      attentionAwaySeconds: 15,
    });
    usePresenceStore.setState({ peers: [] });
  });

  afterEach(() => {
    usePresenceStore.setState({ peers: [] });
    vi.useRealTimers();
  });

  it('reports a student who stops working as idle', () => {
    const student = peer(1, { activity: 1, away: null });
    advance([student], 10);
    expect(stateOf(1)).toBe('attentive');
    advance([student], 95);
    expect(stateOf(1)).toBe('idle');
  });

  it('clears once the student does something', () => {
    advance([peer(1, { activity: 1, away: null })], 100);
    expect(stateOf(1)).toBe('idle');
    advance([peer(1, { activity: 2, away: null })], 2);
    expect(stateOf(1)).toBe('attentive');
  });

  it('reports another window past the away threshold', () => {
    advance([peer(1, { activity: 1, away: null })], 2);
    advance([peer(1, { activity: 1, away: 'hidden' })], 20);
    expect(stateOf(1)).toBe('away');
  });

  it('picks up a threshold change without a reload', () => {
    const student = peer(1, { activity: 1, away: null });
    advance([student], 40);
    expect(stateOf(1)).toBe('attentive');
    useCanvasUiStore.setState({ attentionIdleSeconds: 30 });
    advance([student], 2);
    expect(stateOf(1)).toBe('idle');
  });

  it('watches nobody when the local user is not the tutor', () => {
    local.isTutor = false;
    advance([peer(1, { activity: 1, away: 'hidden' })], 200);
    expect(useAttentionStore.getState().peers.size).toBe(0);
  });

  it('watches nobody with alerts turned off, and drops what it had', () => {
    advance([peer(1, { activity: 1, away: null })], 100);
    expect(stateOf(1)).toBe('idle');
    useCanvasUiStore.setState({ attentionAlertsEnabled: false });
    expect(useAttentionStore.getState().peers.size).toBe(0);
  });

  it('ignores another tutor on the board', () => {
    advance([peer(1, { activity: 1, away: 'hidden' }, true)], 200);
    expect(useAttentionStore.getState().peers.size).toBe(0);
  });

  it('never reports a peer that publishes no attention field', () => {
    advance([peer(1, null)], 300);
    expect(stateOf(1)).toBe('attentive');
  });
});
