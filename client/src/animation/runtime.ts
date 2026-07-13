import type {
  AnimationFrame,
  AnimationRecordingV1,
  RecordedViewport,
  Shape,
} from '@whiteboard/shared';
import { viewportWorldBounds } from '@/canvas/geometry';
import { useCameraStore } from '@/canvas/use-camera-store';
import {
  setAnimationPlayback,
  setCurrentPageForAnimation,
  useDocumentStore,
} from '@/canvas/use-document-store';
import {
  applyAnimationOps,
  createRecording,
  diffAnimationShapes,
  recordingSnapshotAt,
} from './recording';
import { fetchRecordingPayload } from './recordings-api';
import {
  DEFAULT_LOCAL_PLAYBACK,
  useAnimationStore,
} from './use-animation-store';

const CAPTURE_INTERVAL_MS = 1000 / 60;
const COUNTDOWN_SECONDS = 3;

function now(): number {
  return performance.now();
}

function currentViewport(): RecordedViewport {
  const camera = useCameraStore.getState().camera;
  const size = useAnimationStore.getState().viewportSize;
  return {
    ...camera,
    width: Math.max(1, size.width),
    height: Math.max(1, size.height),
  };
}

function sameViewport(a: RecordedViewport, b: RecordedViewport): boolean {
  return (
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.width === b.width &&
    a.height === b.height
  );
}

interface CaptureSession {
  pageId: string;
  startedAt: number;
  createdAt: number;
  initialShapes: Shape[];
  initialViewport: RecordedViewport;
  previousShapes: Shape[];
  previousViewport: RecordedViewport;
  frames: AnimationFrame[];
  flushTimer: ReturnType<typeof setTimeout> | null;
  elapsedTimer: ReturnType<typeof setInterval>;
  lastFlushAt: number;
  unsubscribeDocument: () => void;
  unsubscribeCamera: () => void;
  unsubscribeViewport: () => void;
}

let capture: CaptureSession | null = null;

function cloneShapes(shapes: readonly Shape[]): Shape[] {
  return structuredClone([...shapes]);
}

function flushCapture(): void {
  const active = capture;
  if (!active) return;
  if (active.flushTimer) {
    clearTimeout(active.flushTimer);
    active.flushTimer = null;
  }

  const document = useDocumentStore.getState();
  if (!document.doc.pages[active.pageId]) {
    cancelAnimationRecording();
    return;
  }
  const elapsed = Math.max(0, now() - active.startedAt);
  const nextShapes = document.shapes;
  const viewport = currentViewport();
  const ops = diffAnimationShapes(active.previousShapes, nextShapes);
  const viewportChanged = !sameViewport(active.previousViewport, viewport);
  if (ops.length || viewportChanged) {
    active.frames.push({
      atMs: elapsed,
      ops,
      ...(viewportChanged ? { viewport } : {}),
    });
    active.previousShapes = cloneShapes(nextShapes);
    active.previousViewport = { ...viewport };
  }
  active.lastFlushAt = now();
}

function scheduleCaptureFlush(): void {
  const active = capture;
  if (!active || active.flushTimer) return;
  const delay = Math.max(0, CAPTURE_INTERVAL_MS - (now() - active.lastFlushAt));
  active.flushTimer = setTimeout(flushCapture, delay);
}

let countdownTimer: ReturnType<typeof setInterval> | null = null;

function clearCountdown(): void {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
  useAnimationStore.getState().setRecordingCountdown(null);
}

/**
 * Give the tutor a 3-2-1 lead-in before capture begins so they can get set.
 * Capture (and the t=0 snapshot) starts only when the countdown reaches zero.
 */
export function beginRecordingCountdown(): boolean {
  if (capture || countdownTimer || useAnimationStore.getState().playbackActive) {
    return false;
  }
  const document = useDocumentStore.getState();
  if (!document.doc.pages[document.currentPageId]) return false;

  let remaining = COUNTDOWN_SECONDS;
  useAnimationStore.getState().setRecordingCountdown(remaining);
  countdownTimer = setInterval(() => {
    remaining -= 1;
    if (remaining > 0) {
      useAnimationStore.getState().setRecordingCountdown(remaining);
      return;
    }
    clearCountdown();
    startAnimationRecording();
  }, 1000);
  return true;
}

export function cancelRecordingCountdown(): void {
  clearCountdown();
}

export function startAnimationRecording(): boolean {
  if (capture || useAnimationStore.getState().playbackActive) return false;
  const document = useDocumentStore.getState();
  const pageId = document.currentPageId;
  if (!document.doc.pages[pageId]) return false;
  const initialShapes = cloneShapes(document.shapes);
  const initialViewport = currentViewport();
  const startedAt = now();

  const unsubscribeDocument = useDocumentStore.subscribe((state, previous) => {
    if (!state.doc.pages[pageId]) {
      cancelAnimationRecording();
      return;
    }
    if (state.shapes !== previous.shapes) scheduleCaptureFlush();
  });
  const unsubscribeCamera = useCameraStore.subscribe((state, previous) => {
    if (state.camera !== previous.camera) scheduleCaptureFlush();
  });
  const unsubscribeViewport = useAnimationStore.subscribe((state, previous) => {
    if (state.viewportSize !== previous.viewportSize) scheduleCaptureFlush();
  });
  const elapsedTimer = setInterval(() => {
    if (capture) {
      useAnimationStore.getState().setRecordingElapsed(now() - capture.startedAt);
    }
  }, 100);

  capture = {
    pageId,
    startedAt,
    createdAt: Date.now(),
    initialShapes,
    initialViewport,
    previousShapes: cloneShapes(initialShapes),
    previousViewport: { ...initialViewport },
    frames: [],
    flushTimer: null,
    elapsedTimer,
    lastFlushAt: startedAt,
    unsubscribeDocument,
    unsubscribeCamera,
    unsubscribeViewport,
  };
  useAnimationStore.getState().setRecording(pageId);
  return true;
}

function disposeCapture(): CaptureSession | null {
  const active = capture;
  if (!active) return null;
  if (active.flushTimer) clearTimeout(active.flushTimer);
  clearInterval(active.elapsedTimer);
  active.unsubscribeDocument();
  active.unsubscribeCamera();
  active.unsubscribeViewport();
  capture = null;
  useAnimationStore.getState().setRecording(null);
  return active;
}

/** Stop capturing and return the recording; the caller saves it to the server. */
export function stopAnimationRecording(): AnimationRecordingV1 | null {
  if (!capture) return null;
  flushCapture();
  const active = capture;
  if (!active) return null;
  const durationMs = Math.max(0, now() - active.startedAt);
  const recording = createRecording({
    pageId: active.pageId,
    createdAt: active.createdAt,
    durationMs,
    initialShapes: active.initialShapes,
    initialViewport: active.initialViewport,
    frames: active.frames,
  });
  disposeCapture();
  return recording;
}

export function cancelAnimationRecording(): void {
  disposeCapture();
}

export function playbackPositionAt(
  playback: { status: string; positionMs: number; updatedAt: number },
  at: number,
): number {
  if (playback.status !== 'playing') return Math.max(0, playback.positionMs);
  return Math.max(0, playback.positionMs + at - playback.updatedAt);
}

type PlaybackMode = 'shared' | 'local';

interface PlaybackSession {
  recordingId: string;
  mode: PlaybackMode;
  recording: AnimationRecordingV1;
  sharedVersion: number;
  restorePageId: string;
  restoreCamera: ReturnType<typeof useCameraStore.getState>['camera'];
  shapes: Map<string, Shape>;
  sortedShapes: Shape[];
  nextFrameIndex: number;
  lastPositionMs: number;
  viewport: RecordedViewport;
  appliedViewport: RecordedViewport | null;
}

let playbackSession: PlaybackSession | null = null;
let playbackFrame = 0;
let runtimeUnsubscribe: (() => void) | null = null;
let controller = false;
let locallyEndedVersion = -1;

export function setAnimationController(canControl: boolean): void {
  controller = canControl;
}

function applyRecordedViewport(viewport: RecordedViewport): void {
  const size = useAnimationStore.getState().viewportSize;
  if (size.width <= 0 || size.height <= 0) return;
  const bounds = viewportWorldBounds(
    { x: viewport.x, y: viewport.y, z: viewport.z },
    viewport.width,
    viewport.height,
  );
  useCameraStore.getState().zoomToBounds(bounds, size.width, size.height, 1);
}

/** Kick off a (deduped) payload fetch; the store update re-runs the sync. */
function ensurePayload(recordingId: string): void {
  const boardId = useDocumentStore.getState().boardId;
  if (!boardId) return;
  void fetchRecordingPayload(boardId, recordingId);
}

function beginPlayback(
  recordingId: string,
  recording: AnimationRecordingV1,
  mode: PlaybackMode,
  version: number,
): void {
  if (
    playbackSession &&
    (playbackSession.recordingId !== recordingId ||
      playbackSession.mode !== mode)
  ) {
    endPlaybackSession();
  }
  if (playbackSession) return;
  const document = useDocumentStore.getState();
  const snapshot = recordingSnapshotAt(recording, 0);
  const restorePageId = document.currentPageId;
  const restoreCamera = { ...useCameraStore.getState().camera };
  setCurrentPageForAnimation(recording.pageId);
  playbackSession = {
    recordingId,
    mode,
    recording,
    sharedVersion: version,
    restorePageId,
    restoreCamera,
    shapes: new Map(snapshot.shapes.map((shape) => [shape.id, shape])),
    sortedShapes: snapshot.shapes,
    nextFrameIndex: snapshot.nextFrameIndex,
    lastPositionMs: 0,
    viewport: snapshot.viewport,
    appliedViewport: null,
  };
  useAnimationStore.getState().setPlaybackFrame({
    active: true,
    local: mode === 'local',
    positionMs: 0,
    shapes: snapshot.shapes,
    viewport: snapshot.viewport,
  });
}

function resetPlaybackCursor(session: PlaybackSession, positionMs: number): void {
  const snapshot = recordingSnapshotAt(session.recording, positionMs);
  session.shapes = new Map(snapshot.shapes.map((shape) => [shape.id, shape]));
  session.sortedShapes = snapshot.shapes;
  session.nextFrameIndex = snapshot.nextFrameIndex;
  session.viewport = snapshot.viewport;
}

function renderPlayback(positionMs: number): void {
  const session = playbackSession;
  if (!session) return;
  const clamped = Math.min(session.recording.durationMs, Math.max(0, positionMs));
  let shapesChanged = false;
  if (clamped < session.lastPositionMs) {
    resetPlaybackCursor(session, clamped);
    shapesChanged = true;
  } else {
    while (
      session.nextFrameIndex < session.recording.frames.length &&
      session.recording.frames[session.nextFrameIndex]!.atMs <= clamped
    ) {
      const frame = session.recording.frames[session.nextFrameIndex]!;
      if (frame.ops.length) {
        applyAnimationOps(session.shapes, frame.ops);
        shapesChanged = true;
      }
      if (frame.viewport) session.viewport = frame.viewport;
      session.nextFrameIndex++;
    }
  }
  if (shapesChanged) {
    session.sortedShapes = [...session.shapes.values()].sort((a, b) =>
      a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
    );
  }
  if (!session.appliedViewport || !sameViewport(session.appliedViewport, session.viewport)) {
    applyRecordedViewport(session.viewport);
    session.appliedViewport = { ...session.viewport };
  }
  session.lastPositionMs = clamped;
  useAnimationStore.getState().setPlaybackFrame({
    active: true,
    local: session.mode === 'local',
    positionMs: clamped,
    shapes: session.sortedShapes,
    viewport: session.viewport,
  });
}

function endPlaybackSession(): void {
  const session = playbackSession;
  if (!session) {
    useAnimationStore.getState().setPlaybackFrame({
      active: false,
      positionMs: 0,
      shapes: [],
      viewport: null,
    });
    return;
  }
  cancelAnimationFrame(playbackFrame);
  playbackFrame = 0;
  playbackSession = null;
  useAnimationStore.getState().setPlaybackFrame({
    active: false,
    positionMs: 0,
    shapes: [],
    viewport: null,
  });
  setCurrentPageForAnimation(session.restorePageId);
  useCameraStore.getState().setCamera(session.restoreCamera);
}

function playbackTick(): void {
  playbackFrame = 0;
  const state = useAnimationStore.getState();
  const session = playbackSession;
  if (!session) return;
  const transport =
    session.mode === 'shared' ? state.playback : state.localPlayback;
  if (transport.status !== 'playing') return;
  const position = playbackPositionAt(transport, Date.now());
  renderPlayback(position);
  if (position >= session.recording.durationMs) {
    if (session.mode === 'local') {
      // Pause at the end so the viewer can scrub back or restart.
      state.setLocalPlayback({
        recordingId: session.recordingId,
        status: 'paused',
        positionMs: session.recording.durationMs,
        updatedAt: Date.now(),
      });
    } else {
      locallyEndedVersion = state.playback.version;
      if (controller) {
        queueMicrotask(() => stopSharedAnimationPlayback());
      } else {
        endPlaybackSession();
      }
    }
    return;
  }
  playbackFrame = requestAnimationFrame(playbackTick);
}

function syncPlaybackRuntime(): void {
  const state = useAnimationStore.getState();
  const shared = state.playback;
  const local = state.localPlayback;

  // Shared (tutor-driven) playback preempts a private local session.
  if (shared.status !== 'stopped' && shared.recordingId) {
    if (playbackSession?.mode === 'local') {
      endPlaybackSession();
      if (local.status !== 'stopped') {
        state.setLocalPlayback(DEFAULT_LOCAL_PLAYBACK);
      }
    }
    if (locallyEndedVersion === shared.version) return;
    const recording = state.payloads[shared.recordingId];
    if (!recording) {
      ensurePayload(shared.recordingId);
      return;
    }
    beginPlayback(shared.recordingId, recording, 'shared', shared.version);
    if (!playbackSession) return;
    playbackSession.sharedVersion = shared.version;
    renderPlayback(playbackPositionAt(shared, Date.now()));
    cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
    if (shared.status === 'playing') {
      playbackFrame = requestAnimationFrame(playbackTick);
    }
    return;
  }

  // Shared stopped — never tear down someone's private local session for it.
  if (playbackSession?.mode === 'shared') {
    endPlaybackSession();
  }

  if (local.status !== 'stopped' && local.recordingId) {
    const recording = state.payloads[local.recordingId];
    if (!recording) {
      ensurePayload(local.recordingId);
      return;
    }
    beginPlayback(local.recordingId, recording, 'local', 0);
    renderPlayback(playbackPositionAt(local, Date.now()));
    cancelAnimationFrame(playbackFrame);
    playbackFrame = 0;
    if (local.status === 'playing') {
      playbackFrame = requestAnimationFrame(playbackTick);
    }
    return;
  }

  endPlaybackSession();
}

export function bindAnimationRuntime(): () => void {
  runtimeUnsubscribe?.();
  runtimeUnsubscribe = useAnimationStore.subscribe((state, previous) => {
    if (
      state.playback !== previous.playback ||
      state.localPlayback !== previous.localPlayback ||
      state.payloads !== previous.payloads
    ) {
      syncPlaybackRuntime();
    }
  });
  syncPlaybackRuntime();
  return () => {
    runtimeUnsubscribe?.();
    runtimeUnsubscribe = null;
    clearCountdown();
    cancelAnimationRecording();
    endPlaybackSession();
  };
}

// --- Shared (synchronized, tutor-driven) playback controls ---

export function playRecordingForEveryone(recordingId: string): void {
  if (capture || countdownTimer) return;
  locallyEndedVersion = -1;
  ensurePayload(recordingId);
  setAnimationPlayback({ recordingId, status: 'playing', positionMs: 0 });
}

export function pauseAnimation(): void {
  const playback = useAnimationStore.getState().playback;
  setAnimationPlayback({
    status: 'paused',
    positionMs: playbackPositionAt(playback, Date.now()),
  });
}

export function resumeAnimation(): void {
  const state = useAnimationStore.getState();
  const recording = state.playback.recordingId
    ? state.payloads[state.playback.recordingId]
    : null;
  if (!recording) return;
  const position =
    state.playback.positionMs >= recording.durationMs
      ? 0
      : state.playback.positionMs;
  locallyEndedVersion = -1;
  setAnimationPlayback({ status: 'playing', positionMs: position });
}

export function seekAnimation(positionMs: number): void {
  const playback = useAnimationStore.getState().playback;
  locallyEndedVersion = -1;
  setAnimationPlayback({
    status: playback.status === 'stopped' ? 'paused' : playback.status,
    positionMs,
  });
}

export function restartAnimation(): void {
  locallyEndedVersion = -1;
  setAnimationPlayback({ status: 'playing', positionMs: 0 });
}

export function stopSharedAnimationPlayback(): void {
  const playback = useAnimationStore.getState().playback;
  setAnimationPlayback({
    recordingId: playback.recordingId,
    status: 'stopped',
    positionMs: 0,
  });
}

// --- Local (private, per-client) playback controls ---

export function playRecordingLocally(recordingId: string): void {
  const state = useAnimationStore.getState();
  if (capture || countdownTimer) return;
  if (state.playback.status !== 'stopped') return; // shared playback wins
  state.setLocalPlayback({
    recordingId,
    status: 'playing',
    positionMs: 0,
    updatedAt: Date.now(),
  });
}

export function pauseLocalPlayback(): void {
  const local = useAnimationStore.getState().localPlayback;
  if (!local.recordingId) return;
  useAnimationStore.getState().setLocalPlayback({
    ...local,
    status: 'paused',
    positionMs: playbackPositionAt(local, Date.now()),
    updatedAt: Date.now(),
  });
}

export function resumeLocalPlayback(): void {
  const state = useAnimationStore.getState();
  const local = state.localPlayback;
  const recording = local.recordingId ? state.payloads[local.recordingId] : null;
  if (!recording) return;
  const position =
    local.positionMs >= recording.durationMs ? 0 : local.positionMs;
  state.setLocalPlayback({
    ...local,
    status: 'playing',
    positionMs: position,
    updatedAt: Date.now(),
  });
}

export function seekLocalPlayback(positionMs: number): void {
  const local = useAnimationStore.getState().localPlayback;
  if (!local.recordingId) return;
  useAnimationStore.getState().setLocalPlayback({
    ...local,
    status: local.status === 'stopped' ? 'paused' : local.status,
    positionMs: Math.max(0, positionMs),
    updatedAt: Date.now(),
  });
}

export function restartLocalPlayback(): void {
  const local = useAnimationStore.getState().localPlayback;
  if (!local.recordingId) return;
  useAnimationStore.getState().setLocalPlayback({
    ...local,
    status: 'playing',
    positionMs: 0,
    updatedAt: Date.now(),
  });
}

export function stopLocalPlayback(): void {
  useAnimationStore.getState().setLocalPlayback(DEFAULT_LOCAL_PLAYBACK);
}
