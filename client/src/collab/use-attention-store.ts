import { create } from 'zustand';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { getLocalUser } from './presence';
import { usePresenceStore } from './use-presence-store';
import { nextPeerAttention, type PeerAttention } from './attention-state';

// Thresholds are tens of seconds, so a second's granularity is plenty — and it
// keeps the fold off the 25 Hz cursor path that drives the presence store.
const TICK_MS = 1_000;

interface AttentionStore {
  /** Attention per peer clientId. Empty whenever the watch is not running. */
  peers: Map<number, PeerAttention>;
}

/**
 * The tutor's read of every student's attention.
 *
 * Derived, never persisted, and never published: peers send raw facts and this
 * does the timing locally (see `attention-state.ts`). It only runs for a tutor
 * with alerts on, so a student's client does none of this work and has nothing
 * to render.
 */
export const useAttentionStore = create<AttentionStore>(() => ({
  peers: new Map(),
}));

const tracked = new Map<number, PeerAttention>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick(): void {
  const { peers } = usePresenceStore.getState();
  const { attentionIdleSeconds, attentionAwaySeconds } =
    useCanvasUiStore.getState();
  const thresholds = {
    idleSeconds: attentionIdleSeconds,
    awaySeconds: attentionAwaySeconds,
  };
  const now = performance.now();

  const next = new Map<number, PeerAttention>();
  let changed = false;
  for (const peer of peers) {
    // Only students. A second tutor on the board is a colleague, not someone
    // whose engagement this is for.
    if (peer.isTutor) continue;
    const prev = tracked.get(peer.clientId);
    const entry = nextPeerAttention(prev, peer.attention, thresholds, now);
    next.set(peer.clientId, entry);
    if (prev?.state !== entry.state) changed = true;
  }

  if (next.size !== tracked.size) changed = true;
  tracked.clear();
  for (const [clientId, entry] of next) tracked.set(clientId, entry);
  // Only a state change is worth a render. `sinceMs` also moves while a peer is
  // attentive, and no one displays how long someone has been paying attention.
  if (changed) useAttentionStore.setState({ peers: next });
}

function watching(): boolean {
  if (getLocalUser()?.isTutor !== true) return false;
  if (!useCanvasUiStore.getState().attentionAlertsEnabled) return false;
  return usePresenceStore.getState().peers.some((peer) => !peer.isTutor);
}

function sync(): void {
  const shouldRun = watching();
  if (shouldRun === (timer !== null)) return;
  if (shouldRun) {
    timer = setInterval(tick, TICK_MS);
    tick();
    return;
  }
  clearInterval(timer!);
  timer = null;
  tracked.clear();
  if (useAttentionStore.getState().peers.size > 0) {
    useAttentionStore.setState({ peers: new Map() });
  }
}

usePresenceStore.subscribe(sync);
useCanvasUiStore.subscribe(sync);
