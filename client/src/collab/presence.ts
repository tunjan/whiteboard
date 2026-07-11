import type { Awareness } from 'y-protocols/awareness';
import type { Point } from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import { viewportWorldBounds } from '@/canvas/geometry';
import { setCurrentPage } from '@/canvas/use-document-store';
import { useCameraStore } from '@/canvas/use-camera-store';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import {
  type PeerPresence,
  type TextSelectionPresence,
  type ViewportPresence,
  usePresenceStore,
} from './use-presence-store';

export interface LocalUser {
  name: string;
  color: string;
  isTutor: boolean;
  avatar: string;
}

// Awareness payload shape: { user, cursor, viewport, summon }. Camera/viewport
// state stays ephemeral and local; awareness only lets peers mirror it live.
let awareness: Awareness | null = null;
let onChange: (() => void) | null = null;
let localUser: LocalUser | null = null;
let localPage: string | null = null;
let localFollowing = false;
let localTextSelection: TextSelectionPresence | null = null;
let lastCursorSent = 0;
let lastViewportSent = 0;
let lastSummonSent = 0;
let latestViewport: ViewportPresence | null = null;

const CURSOR_THROTTLE_MS = 40;
const VIEWPORT_THROTTLE_MS = 70;

// Previous peer objects keyed by clientId. Awareness fires `change` on any
// peer's update (cursors publish at 25 Hz), but most peers are unchanged each
// time. Reusing the prior object when every field matches keeps its reference
// stable, so consumers that select a single peer (e.g. Canvas → tutor) hold
// their memo and only components watching the moved peer re-render.
let prevPeers = new Map<number, PeerPresence>();

function publishPeers(a: Awareness): void {
  const peers: PeerPresence[] = [];
  const next = new Map<number, PeerPresence>();
  a.getStates().forEach((state, clientId) => {
    if (clientId === a.clientID) return;
    const user = state.user as LocalUser | undefined;
    if (!user?.name) return;
    const avatar = user.avatar || user.name;
    // Awareness returns the same object reference for a field until that field
    // is re-set, so `===` on cursor/viewport correctly detects "unchanged".
    const cursor = (state.cursor as Point | null) ?? null;
    const viewport = (state.viewport as ViewportPresence | null) ?? null;
    const summon = (state.summon as number | null) ?? null;
    const page = (state.page as string | null) ?? null;
    const following = (state.following as boolean | undefined) ?? false;
    const textSelection =
      (state.textSelection as TextSelectionPresence | null) ?? null;
    const prev = prevPeers.get(clientId);
    const peer: PeerPresence =
      prev &&
      prev.name === user.name &&
      prev.color === user.color &&
      prev.isTutor === user.isTutor &&
      prev.avatar === avatar &&
      prev.cursor === cursor &&
      prev.viewport === viewport &&
      prev.summon === summon &&
      prev.page === page &&
      prev.following === following &&
      prev.textSelection === textSelection
        ? prev
        : {
            clientId,
            name: user.name,
            color: user.color,
            isTutor: user.isTutor,
            avatar,
            cursor,
            viewport,
            summon,
            page,
            following,
            textSelection,
          };
    next.set(clientId, peer);
    peers.push(peer);
  });
  prevPeers = next;
  usePresenceStore.getState().setPeers(peers);
}

/** Bind/unbind the active provider's awareness. Called by loadBoard. */
export function setActiveAwareness(next: Awareness | null): void {
  if (awareness && onChange) awareness.off('change', onChange);
  awareness = next;
  onChange = null;
  prevPeers = new Map();
  if (!next) {
    usePresenceStore.getState().setPeers([]);
    return;
  }
  onChange = () => publishPeers(next);
  next.on('change', onChange);
  if (localUser) next.setLocalStateField('user', localUser);
  if (localPage) next.setLocalStateField('page', localPage);
  next.setLocalStateField('following', localFollowing);
  next.setLocalStateField('textSelection', localTextSelection);
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

export function setLocalTextSelection(
  selection: TextSelectionPresence | null,
): void {
  localTextSelection = selection;
  awareness?.setLocalStateField('textSelection', selection);
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

/**
 * Move the local camera to mirror a peer's current view: switch to their page,
 * then fit their viewport into ours (same math as follow/summon). A no-op until
 * the peer has published a viewport and we have a measured local viewport.
 */
export function jumpToPeerViewport(peer: PeerPresence): void {
  if (!peer.viewport) return;
  const localSize = latestViewport?.size;
  if (!localSize || localSize.width <= 0 || localSize.height <= 0) return;
  stopFollowingForManualCameraChange();
  if (peer.page) setCurrentPage(peer.page);
  const bounds = viewportWorldBounds(
    peer.viewport.camera,
    peer.viewport.size.width,
    peer.viewport.size.height,
  );
  useCameraStore
    .getState()
    .zoomToBounds(bounds, localSize.width, localSize.height, 1);
}
