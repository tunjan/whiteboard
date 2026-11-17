import type { Awareness } from 'y-protocols/awareness';
import {
  decodeEphemeral,
  encodeEphemeral,
  parseVoicePresence,
  type EphemeralMessage,
  type LaserOp,
  type Point,
} from '@whiteboard/shared';
import type { Camera } from '@/canvas/camera';
import {
  ERASER_TRAIL_OPACITY,
  type EraserScribble,
} from '@/canvas/use-eraser-trail-store';
import type { LaserStroke } from '@/canvas/use-laser-store';
import { viewportWorldBounds } from '@/canvas/geometry';
import { setCurrentPage } from '@/canvas/use-document-store';
import { useCameraStore } from '@/canvas/use-camera-store';
import { useEraserStore } from '@/canvas/use-eraser-store';
import { CURSOR_INTERVAL_MS } from '@/collab/cursor-interpolation';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import {
  parseAttentionPresence,
  type AttentionPresence,
} from './attention-state';
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
let onChange: ((changes: { removed: number[] }) => void) | null = null;
let localUser: LocalUser | null = null;
let localPage: string | null = null;
let localFollowing = false;
let localLatencyMs: number | null = null;
let localTextSelection: TextSelectionPresence | null = null;
let localVoice: VoicePresence | null = null;
let localAttention: AttentionPresence | null = null;
let lastCursorSent = 0;
let cursorTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let latestCursor: Point | null = null;
let lastViewportSent = 0;
let lastSummonSent = 0;
let latestViewport: ViewportPresence | null = null;
let lastLaserSent = Number.NEGATIVE_INFINITY;
let laserTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let latestLaser: LaserStroke[] = [];
let localSelection: string[] = [];
let lastSelectionSent = 0;
let selectionTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let localEraserScribbles: EraserScribble[] = [];
let lastEraserScribblesSent = Number.NEGATIVE_INFINITY;
let eraserScribblesTrailingTimer: ReturnType<typeof setTimeout> | null = null;
let localCursorType: PeerPresence['cursorType'] = 'pointer';

/** The board provider's stateless channel, which carries laser and eraser trails. */
export interface EphemeralChannel {
  on: (
    event: 'stateless',
    listener: (event: { payload: string }) => void,
  ) => unknown;
  off: (
    event: 'stateless',
    listener: (event: { payload: string }) => void,
  ) => unknown;
  sendStateless: (payload: string) => void;
}
let channel: EphemeralChannel | null = null;
let onStateless: ((event: { payload: string }) => void) | null = null;
/** How much of each local laser stroke peers already hold. */
let laserSent = new Map<string, { count: number; done: boolean }>();
/** Peers' laser strokes and eraser trails, rebuilt from their messages. */
let remoteLaser = new Map<number, LaserStroke[]>();
let remoteScribbles = new Map<number, EraserScribble[]>();
let localErasing: string[] = [];
let lastErasingSent = Number.NEGATIVE_INFINITY;
let erasingTrailingTimer: ReturnType<typeof setTimeout> | null = null;

// Peers play the cursor back as a curve through these positions, so it can
// publish far less often than it moves. See `CursorInterpolator`.
const CURSOR_THROTTLE_MS = CURSOR_INTERVAL_MS;
const VIEWPORT_THROTTLE_MS = 70;
const LASER_THROTTLE_MS = 40;
const SELECTION_THROTTLE_MS = 60;
// Each update carries whole point arrays, so this stays well below the local
// animation frame rate. Peers interpolate nothing here, but
// the trail is a momentary decoration and the trailing flush still lands its end.
const ERASER_SCRIBBLES_THROTTLE_MS = 60;
const MAX_SCRIBBLE_POINTS = 16;
const ERASING_THROTTLE_MS = 60;

// Previous peer objects keyed by clientId. Awareness fires `change` on any
// peer's update (cursors publish at 5 Hz, lasers faster), but most peers are unchanged each
// time. Reusing the prior object when every field matches keeps its reference
// stable, so consumers that select a single peer (e.g. Canvas → tutor) hold
// their memo and only components watching the moved peer re-render.
let prevPeers = new Map<number, PeerPresence>();

function publishPeers(a: Awareness): void {
  const peers: PeerPresence[] = [];
  const next = new Map<number, PeerPresence>();
  const erasing: string[] = [];
  a.getStates().forEach((state, clientId) => {
    if (clientId === a.clientID) return;
    if (Array.isArray(state.erasing)) {
      for (const id of state.erasing) {
        if (typeof id === 'string') erasing.push(id);
      }
    }
    const user = state.user as LocalUser | undefined;
    if (!user?.name) return;
    // Awareness returns the same object reference for a field until that field
    // is re-set, so `===` on cursor/viewport correctly detects "unchanged".
    const cursor = (state.cursor as Point | null) ?? null;
    const cursorType: PeerPresence['cursorType'] =
      state.cursorType === 'cross' ? 'cross' : 'pointer';
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
    const laser = remoteLaser.get(clientId) ?? null;
    const selection = (state.selection as string[] | null) ?? null;
    const scribbles = remoteScribbles.get(clientId) ?? null;
    const prev = prevPeers.get(clientId);
    const parsedAttention = parseAttentionPresence(state.attention);
    const attention =
      parsedAttention &&
      prev?.attention &&
      parsedAttention.activity === prev.attention.activity &&
      parsedAttention.away === prev.attention.away
        ? prev.attention
        : parsedAttention;
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
      prev.cursorType === cursorType &&
      prev.viewport === viewport &&
      prev.summon === summon &&
      prev.page === page &&
      prev.following === following &&
      prev.latencyMs === latencyMs &&
      prev.textSelection === textSelection &&
      prev.laser === laser &&
      prev.selection === selection &&
      prev.scribbles === scribbles &&
      prev.voice === voice &&
      prev.attention === attention
        ? prev
        : {
            clientId,
            name: user.name,
            color: user.color,
            isTutor: user.isTutor,
            cursor,
            cursorType,
            viewport,
            summon,
            page,
            following,
            latencyMs,
            textSelection,
            laser,
            selection,
            scribbles,
            voice,
            attention,
          };
    next.set(clientId, peer);
    peers.push(peer);
  });
  prevPeers = next;
  usePresenceStore.getState().setPeers(peers);
  useEraserStore.getState().setRemote([...new Set(erasing)]);
}

/** Bind/unbind the active provider's awareness. Called by loadBoard. */
export function setActiveAwareness(
  next: Awareness | null,
  nextChannel: EphemeralChannel | null = null,
): void {
  if (awareness && onChange) awareness.off('change', onChange);
  if (channel && onStateless) channel.off('stateless', onStateless);
  channel = nextChannel;
  onStateless = null;
  remoteLaser = new Map();
  remoteScribbles = new Map();
  // Peers on the new connection hold none of our strokes, so the next send
  // carries each one whole.
  laserSent = new Map();
  lastLaserSent = Number.NEGATIVE_INFINITY;
  if (laserTrailingTimer !== null) {
    clearTimeout(laserTrailingTimer);
    laserTrailingTimer = null;
  }
  // Eraser scribbles are momentary and deliberately not republished on rebind
  // (like the cursor and laser). Dropping them here keeps a flush that
  // was still pending on the old connection from landing on the new one to
  // describe a stroke that is long over.
  if (eraserScribblesTrailingTimer !== null) {
    clearTimeout(eraserScribblesTrailingTimer);
    eraserScribblesTrailingTimer = null;
  }
  localEraserScribbles = [];
  if (erasingTrailingTimer !== null) {
    clearTimeout(erasingTrailingTimer);
    erasingTrailingTimer = null;
  }
  lastErasingSent = Number.NEGATIVE_INFINITY;
  if (cursorTrailingTimer !== null) {
    clearTimeout(cursorTrailingTimer);
    cursorTrailingTimer = null;
  }
  // A new connection has no send history to be throttled against, so the first
  // point of the next stroke goes out at once instead of waiting out a window
  // measured against the previous session.
  lastEraserScribblesSent = Number.NEGATIVE_INFINITY;
  awareness = next;
  onChange = null;
  prevPeers = new Map();
  if (!next) {
    usePresenceStore.getState().setPeers([]);
    useEraserStore.getState().setRemote([]);
    return;
  }
  onChange = ({ removed }: { removed: number[] }) => {
    for (const clientId of removed) {
      remoteLaser.delete(clientId);
      remoteScribbles.delete(clientId);
    }
    publishPeers(next);
  };
  next.on('change', onChange);
  if (channel) {
    onStateless = ({ payload }) => {
      const message = decodeEphemeral(payload);
      if (!message || message.from === next.clientID) return;
      receiveEphemeral(message);
      publishPeers(next);
    };
    channel.on('stateless', onStateless);
  }
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
  a.setLocalStateField('attention', localAttention);
  a.setLocalStateField('cursorType', localCursorType);
  a.setLocalStateField(
    'selection',
    localSelection.length > 0 ? localSelection : null,
  );
  a.setLocalStateField(
    'erasing',
    localErasing.length > 0 ? localErasing : null,
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

/**
 * Publish this client's own attention facts for the tutor's view. Sticky rather
 * than momentary: the last value has to stand while a hidden tab's timers are
 * frozen, which is exactly when it matters.
 */
export function setLocalAttention(attention: AttentionPresence | null): void {
  localAttention = attention;
  awareness?.setLocalStateField('attention', attention);
}

function sendCursor(): void {
  if (!awareness) return;
  lastCursorSent = performance.now();
  awareness.setLocalStateField('cursor', latestCursor);
}

/**
 * Publish the local cursor at most once per `CURSOR_THROTTLE_MS`, with a
 * trailing send so the position the pointer comes to rest at always lands.
 * Leaving the canvas (`null`) goes out at once.
 */
export function setLocalCursor(point: Point | null): void {
  latestCursor = point;
  if (!awareness) return;
  if (!point) {
    if (cursorTrailingTimer !== null) {
      clearTimeout(cursorTrailingTimer);
      cursorTrailingTimer = null;
    }
    sendCursor();
    return;
  }
  if (cursorTrailingTimer !== null) return;
  const elapsed = performance.now() - lastCursorSent;
  if (elapsed >= CURSOR_THROTTLE_MS) {
    sendCursor();
    return;
  }
  cursorTrailingTimer = setTimeout(() => {
    cursorTrailingTimer = null;
    sendCursor();
  }, CURSOR_THROTTLE_MS - elapsed);
}

/** Rounded to 1/100 world unit: invisible, and a third of the JSON digits. */
const round = (n: number) => Math.round(n * 100) / 100;

function sendLaser(): void {
  if (!awareness || !channel) return;
  lastLaserSent = performance.now();
  // Only what peers do not have yet: new points, newly finished strokes, and
  // strokes that are gone.
  const ops: LaserOp[] = [];
  const live = new Set<string>();
  for (const stroke of latestLaser) {
    live.add(stroke.id);
    const sent = laserSent.get(stroke.id);
    const count = sent?.count ?? 0;
    if (stroke.points.length > count) {
      ops.push({
        op: 'add',
        id: stroke.id,
        at: count,
        points: stroke.points
          .slice(count)
          .flatMap((p) => [round(p.x), round(p.y)]),
      });
    }
    if (stroke.done && !sent?.done) ops.push({ op: 'done', id: stroke.id });
    laserSent.set(stroke.id, {
      count: stroke.points.length,
      done: stroke.done,
    });
  }
  for (const id of laserSent.keys()) {
    if (live.has(id)) continue;
    ops.push({ op: 'drop', id });
    laserSent.delete(id);
  }
  if (ops.length === 0) return;
  channel.sendStateless(
    encodeEphemeral({ from: awareness.clientID, kind: 'laser', ops }),
  );
}

/** Cap on a peer's strokes held at once; beyond it the oldest are dropped. */
const MAX_REMOTE_LASER_STROKES = 64;

function receiveEphemeral(message: EphemeralMessage): void {
  if (message.kind === 'scribbles') {
    if (message.scribbles.length === 0) {
      remoteScribbles.delete(message.from);
      return;
    }
    remoteScribbles.set(
      message.from,
      message.scribbles.map((scribble) => ({
        id: scribble.id,
        points: unflatten(scribble.points, 3).map(([x, y, pressure]) => ({
          x: x!,
          y: y!,
          pressure: pressure!,
        })),
        state: scribble.state,
        color: 'muted-1',
        size: scribble.size,
        opacity: ERASER_TRAIL_OPACITY,
        taper: true,
      })),
    );
    return;
  }
  let strokes = remoteLaser.get(message.from) ?? [];
  for (const op of message.ops) {
    const stroke = strokes.find((s) => s.id === op.id);
    if (op.op === 'drop') {
      if (stroke) strokes = strokes.filter((s) => s !== stroke);
    } else if (op.op === 'done') {
      if (stroke) {
        strokes = strokes.map((s) => (s === stroke ? { ...s, done: true } : s));
      }
    } else {
      const added = unflatten(op.points, 2).map(([x, y]) => ({ x: x!, y: y! }));
      // Written over the held points from `at`, so a stroke re-sent whole after
      // the sender reconnects replaces what is held rather than doubling it.
      const held = stroke?.points ?? [];
      const points = [
        ...held.slice(0, op.at),
        ...added,
        ...held.slice(op.at + added.length),
      ];
      strokes = stroke
        ? strokes.map((s) => (s === stroke ? { ...s, points } : s))
        : [...strokes, { id: op.id, points, done: false }].slice(
            -MAX_REMOTE_LASER_STROKES,
          );
    }
  }
  if (strokes.length > 0) remoteLaser.set(message.from, strokes);
  else remoteLaser.delete(message.from);
}

function unflatten(values: number[], stride: number): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < values.length; i += stride) {
    out.push(values.slice(i, i + stride));
  }
  return out;
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

/** An even spread of samples, both ends kept; the peer rounds the curve again. */
function thinScribblePoints<T>(points: T[]): T[] {
  if (points.length <= MAX_SCRIBBLE_POINTS) return points;
  const step = (points.length - 1) / (MAX_SCRIBBLE_POINTS - 1);
  return Array.from(
    { length: MAX_SCRIBBLE_POINTS },
    (_, i) => points[Math.round(i * step)]!,
  );
}

function sendEraserScribbles(): void {
  if (!awareness || !channel) return;
  lastEraserScribblesSent = performance.now();
  channel.sendStateless(
    encodeEphemeral({
      from: awareness.clientID,
      kind: 'scribbles',
      scribbles: localEraserScribbles.map((scribble) => ({
        id: scribble.id,
        points: thinScribblePoints(scribble.points).flatMap((p) => [
          round(p.x),
          round(p.y),
          round(p.pressure ?? 0.5),
        ]),
        state: scribble.state,
        size: scribble.size,
      })),
    }),
  );
}

/**
 * Publish the local eraser's session-only scribbles. Updates are throttled and
 * keep a trailing flush so the final stopping or empty state cannot be stranded
 * behind it.
 */
export function setLocalEraserScribbles(scribbles: EraserScribble[]): void {
  localEraserScribbles = scribbles;
  if (!awareness) return;
  if (eraserScribblesTrailingTimer !== null) return;
  const elapsed = performance.now() - lastEraserScribblesSent;
  if (elapsed >= ERASER_SCRIBBLES_THROTTLE_MS) {
    sendEraserScribbles();
    return;
  }
  eraserScribblesTrailingTimer = setTimeout(() => {
    eraserScribblesTrailingTimer = null;
    sendEraserScribbles();
  }, ERASER_SCRIBBLES_THROTTLE_MS - elapsed);
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
 * Publish the ids the local eraser stroke has queued, so peers fade them too
 * until release. Growth is throttled with a trailing flush; the empty set that
 * ends a stroke goes out at once — the eraser clears it straight after its
 * delete transaction, so peers receive the delete first and fade the shapes out
 * from their marked opacity instead of flashing them back to full.
 */
export function setLocalErasing(ids: string[]): void {
  localErasing = ids;
  if (!awareness) return;
  if (ids.length === 0) {
    if (erasingTrailingTimer !== null) {
      clearTimeout(erasingTrailingTimer);
      erasingTrailingTimer = null;
    }
    sendErasing();
    return;
  }
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

/** Publish the remote cursor glyph that matches the active local tool. */
export function setLocalCursorType(
  cursorType: PeerPresence['cursorType'],
): void {
  if (cursorType === localCursorType) return;
  localCursorType = cursorType;
  awareness?.setLocalStateField('cursorType', cursorType);
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
