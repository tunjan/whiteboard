import type { Awareness } from 'y-protocols/awareness';
import type { Point } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import {
  type PeerPresence,
  type ViewportPresence,
  usePresenceStore,
} from './use-presence-store';

export interface LocalUser {
  name: string;
  color: string;
  isTutor: boolean;
}

// Awareness payload shape: { user, cursor, viewport, summon }. Camera/viewport
// state stays ephemeral and local; awareness only lets peers mirror it live.
let awareness: Awareness | null = null;
let onChange: (() => void) | null = null;
let localUser: LocalUser | null = null;
let localPage: string | null = null;
let localFollowing = false;
let lastCursorSent = 0;
let lastViewportSent = 0;
let lastSummonSent = 0;
let latestViewport: ViewportPresence | null = null;

const CURSOR_THROTTLE_MS = 40;
const VIEWPORT_THROTTLE_MS = 70;

function publishPeers(a: Awareness): void {
  const peers: PeerPresence[] = [];
  a.getStates().forEach((state, clientId) => {
    if (clientId === a.clientID) return;
    const user = state.user as LocalUser | undefined;
    if (!user?.name) return;
    peers.push({
      clientId,
      name: user.name,
      color: user.color,
      isTutor: user.isTutor,
      cursor: (state.cursor as Point | null) ?? null,
      viewport: (state.viewport as ViewportPresence | null) ?? null,
      summon: (state.summon as number | null) ?? null,
      page: (state.page as string | null) ?? null,
      following: (state.following as boolean | undefined) ?? false,
    });
  });
  usePresenceStore.getState().setPeers(peers);
}

/** Bind/unbind the active provider's awareness. Called by loadBoard. */
export function setActiveAwareness(next: Awareness | null): void {
  if (awareness && onChange) awareness.off('change', onChange);
  awareness = next;
  onChange = null;
  if (!next) {
    usePresenceStore.getState().setPeers([]);
    return;
  }
  onChange = () => publishPeers(next);
  next.on('change', onChange);
  if (localUser) next.setLocalStateField('user', localUser);
  if (localPage) next.setLocalStateField('page', localPage);
  next.setLocalStateField('following', localFollowing);
  publishPeers(next);
}

export function setLocalUser(user: LocalUser): void {
  localUser = user;
  awareness?.setLocalStateField('user', user);
}

/** Publish which page this client is viewing so peers can follow across pages. */
export function setLocalPage(pageId: string): void {
  localPage = pageId;
  awareness?.setLocalStateField('page', pageId);
}

/** Publish whether this client is following the tutor so the tutor can see it. */
export function setLocalFollowing(following: boolean): void {
  localFollowing = following;
  awareness?.setLocalStateField('following', following);
}

export function setLocalCursor(point: Point | null): void {
  if (!awareness) return;
  if (point) {
    const now = performance.now();
    if (now - lastCursorSent < CURSOR_THROTTLE_MS) return;
    lastCursorSent = now;
  }
  awareness.setLocalStateField('cursor', point);
}

export function setLocalViewport(
  camera: Camera,
  size: { width: number; height: number },
): void {
  if (!awareness) return;
  latestViewport = { camera, size };
  const now = performance.now();
  if (now - lastViewportSent < VIEWPORT_THROTTLE_MS) return;
  lastViewportSent = now;
  awareness.setLocalStateField('viewport', latestViewport);
}

export function summonAll(): void {
  if (!awareness) return;
  if (latestViewport) awareness.setLocalStateField('viewport', latestViewport);
  const nonce = Math.max(Date.now(), lastSummonSent + 1);
  lastSummonSent = nonce;
  awareness.setLocalStateField('summon', nonce);
}
