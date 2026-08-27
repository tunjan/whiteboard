import type { Awareness } from 'y-protocols/awareness';
import {
  parseVoicePresence,
  type Point,
} from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import type { LaserStroke } from '@/canvas/use-laser-store';
import { viewportWorldBounds } from '@/canvas/geometry';
import { setCurrentPage } from '@/canvas/use-document-store';
import { useCameraStore } from '@/canvas/use-camera-store';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import {
  type PeerPresence,
  type TextSelectionPresence,
  type VoicePresence,
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
let localLatencyMs: number | null = null;
let localTextSelection: TextSelectionPresence | null = null;
let localVoice: VoicePresence | null = null;
let lastCursorSent = 0;
let lastViewportSent = 0;
let lastSummonSent = 0;
let latestViewport: ViewportPresence | null = null;
let lastLaserSent = 0;
let laserTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let latestLaser: LaserStroke[] = [];
let localSelection: string[] = [];
let lastSelectionSent = 0;
let selectionTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let localErasing: string[] = [];
let lastErasingSent = 0;
let erasingTrailingTimer: ReturnType<typeof setTimeout> | null = null;

const CURSOR_THROTTLE_MS = 40;
const VIEWPORT_THROTTLE_MS = 70;
const LASER_THROTTLE_MS = 40;
const SELECTION_THROTTLE_MS = 60;
const ERASING_THROTTLE_MS = 60;

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
    // Awareness returns the same object reference for a field until that field
    // is re-set, so `===` on cursor/viewport correctly detects "unchanged".
    const cursor = (state.cursor as Point | null) ?? null;
    const viewport = (state.viewport as ViewportPresence | null) ?? null;
    const summon = (state.summon as number | null) ?? null;
    const page = (state.page as string | null) ?? null;
    const following = (state.following as boolean | undefined) ?? false;
    const latencyMs =
      typeof state.latencyMs === 'number' &&
      Number.isFinite(state.latencyMs) &&
      state.latencyMs >= 0
        ? Math.round(state.latencyMs)
        : null;
    const textSelection =
      (state.textSelection as TextSelectionPresence | null) ?? null;
    const laser = (state.laser as LaserStroke[] | null) ?? null;
    const selection = (state.selection as string[] | null) ?? null;
    const erasing = (state.erasing as string[] | null) ?? null;
    const prev = prevPeers.get(clientId);
    const parsedVoice = parseVoicePresence(state.voice);
    const voice =
      parsedVoice &&
      prev?.voice &&
      parsedVoice.inCall === prev.voice.inCall &&
      parsedVoice.muted === prev.voice.muted &&
      parsedVoice.speaking === prev.voice.speaking &&
      parsedVoice.camera === prev.voice.camera &&
      parsedVoice.screen === prev.voice.screen &&
      parsedVoice.sessionId === prev.voice.sessionId
        ? prev.voice
        : parsedVoice;
    const peer: PeerPresence =
      prev &&
      prev.name === user.name &&
      prev.color === user.color &&
      prev.isTutor === user.isTutor &&
      prev.cursor === cursor &&
      prev.viewport === viewport &&
      prev.summon === summon &&
      prev.page === page &&
      prev.following === following &&
      prev.latencyMs === latencyMs &&
      prev.textSelection === textSelection &&
      prev.laser === laser &&
      prev.selection === selection &&
      prev.erasing === erasing &&
      prev.voice === voice
        ? prev
        : {
            clientId,
            name: user.name,
            color: user.color,
            isTutor: user.isTutor,
            cursor,
            viewport,
            summon,
            page,
            following,
            latencyMs,
            textSelection,
            laser,
            selection,
            erasing,
            voice,
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
  // An erase stroke's marks are momentary and deliberately not republished on
  // rebind (like the cursor and laser). Dropping them here keeps a flush that
  // was still pending on the old connection from landing on the new one to
  // describe a stroke that is long over.
  if (erasingTrailingTimer !== null) {
    clearTimeout(erasingTrailingTimer);
    erasingTrailingTimer = null;
  }
  localErasing = [];
  // A new connection has no send history to be throttled against, so the first
  // mark of the next stroke goes out at once instead of waiting out a window
  // measured against the previous session.
  lastErasingSent = 0;
  awareness = next;
  onChange = null;
  prevPeers = new Map();
  if (!next) {
    usePresenceStore.getState().setPeers([]);
    return;
  }
  onChange = () => publishPeers(next);
  next.on('change', onChange);
  publishLocalState(next);
  publishPeers(next);
}

/** Re-send every sticky local field. Cursor/viewport/laser are omitted on
 *  purpose: they are momentary and republish themselves on the next move. */
function publishLocalState(a: Awareness): void {
  if (localUser) a.setLocalStateField('user', localUser);
  if (localPage) a.setLocalStateField('page', localPage);
  a.setLocalStateField('following', localFollowing);
  a.setLocalStateField('latencyMs', localLatencyMs);
  a.setLocalStateField('textSelection', localTextSelection);
  a.setLocalStateField('voice', localVoice);
  a.setLocalStateField(
    'selection',
    localSelection.length > 0 ? localSelection : null,
  );
}

/**
 * The collab provider drops our own awareness state on `pagehide`, so peers see
 * us leave when the tab goes away. A bfcache restore — an app switch on mobile,
 * or a back navigation — brings the page back without a reload, and yjs makes
 * `setLocalStateField` a no-op while the local state is null. Without this the
 * client stays invisible to peers for the rest of the page's life: no cursor,
 * no page, and no voice membership, while its own UI still looks connected.
 */
export function restoreLocalPresence(): void {
  if (!awareness || awareness.getLocalState() !== null) return;
  awareness.setLocalState({});
  publishLocalState(awareness);
}

if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', restoreLocalPresence);
}

export function setLocalUser(user: LocalUser): void {
  localUser = user;
  awareness?.setLocalStateField('user', user);
}

/** The local user's identity, or null before it's been set. */
export function getLocalUser(): LocalUser | null {
  return localUser;
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

/** Publish this client's own server round-trip time for tutor diagnostics. */
export function setLocalLatency(latencyMs: number | null): void {
  localLatencyMs = latencyMs;
  awareness?.setLocalStateField('latencyMs', latencyMs);
}

/** Publish this client's in-board voice membership and mute state. */
export function setLocalVoice(voice: VoicePresence | null): void {
  localVoice = voice;
  awareness?.setLocalStateField('voice', voice);
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

function sendLaser(): void {
  if (!awareness) return;
  lastLaserSent = performance.now();
  awareness.setLocalStateField(
    'laser',
    latestLaser.length > 0 ? latestLaser : null,
  );
}

/**
 * Publish the local laser strokes. Point appends arrive per pointer move, so
 * sends are throttled like the cursor — but with a trailing send so the final
 * state of a burst (stroke finished / removed) always reaches peers.
 */
export function setLocalLaser(strokes: LaserStroke[]): void {
  latestLaser = strokes;
  if (!awareness) return;
  if (laserTrailingTimer !== null) return;
  const elapsed = performance.now() - lastLaserSent;
  if (elapsed >= LASER_THROTTLE_MS) {
    sendLaser();
    return;
  }
  laserTrailingTimer = setTimeout(() => {
    laserTrailingTimer = null;
    sendLaser();
  }, LASER_THROTTLE_MS - elapsed);
}

function sendSelection(): void {
  if (!awareness) return;
  lastSelectionSent = performance.now();
  awareness.setLocalStateField(
    'selection',
    localSelection.length > 0 ? localSelection : null,
  );
}

/**
 * Publish which shapes this client has selected so peers can outline them.
 * Marquee drags restate the selection every frame, so sends are throttled with
 * a trailing flush — the same treatment as laser strokes.
 */
export function setLocalSelection(ids: string[]): void {
  // Marquee drags re-emit an identical selection on most frames; skip those
  // outright so an unchanged selection never wakes every peer's render.
  if (
    ids.length === localSelection.length &&
    ids.every((id, i) => id === localSelection[i])
  ) {
    return;
  }
  localSelection = ids;
  if (!awareness) return;
  if (selectionTrailingTimer !== null) return;
  const elapsed = performance.now() - lastSelectionSent;
  if (elapsed >= SELECTION_THROTTLE_MS) {
    sendSelection();
    return;
  }
  selectionTrailingTimer = setTimeout(() => {
    selectionTrailingTimer = null;
    sendSelection();
  }, SELECTION_THROTTLE_MS - elapsed);
}

function sendErasing(): void {
  if (!awareness) return;
  lastErasingSent = performance.now();
  awareness.setLocalStateField(
    'erasing',
    localErasing.length > 0 ? localErasing : null,
  );
}

/**
 * Publish which shapes this client's erase stroke has marked, so peers dim them
 * for as long as the stroke is held rather than watching them vanish with no
 * warning. Throttled with a trailing flush like the selection: the flush is what
 * guarantees the *final* state of a burst arrives, and here that matters more
 * than usual — a dropped clear would leave a peer dimming a shape that is no
 * longer being erased, with nothing to correct it.
 */
export function setLocalErasing(ids: string[]): void {
  if (
    ids.length === localErasing.length &&
    ids.every((id, i) => id === localErasing[i])
  ) {
    return;
  }
  localErasing = ids;
  if (!awareness) return;
  if (erasingTrailingTimer !== null) return;
  const elapsed = performance.now() - lastErasingSent;
  if (elapsed >= ERASING_THROTTLE_MS) {
    sendErasing();
    return;
  }
  erasingTrailingTimer = setTimeout(() => {
    erasingTrailingTimer = null;
    sendErasing();
  }, ERASING_THROTTLE_MS - elapsed);
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
