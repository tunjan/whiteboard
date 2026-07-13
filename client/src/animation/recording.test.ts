import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type {
  AnimationRecordingV1,
  DrawShape,
  RectangleShape,
  Shape,
} from '@whiteboard/shared';
import {
  editor,
  loadBoard,
  setAnimationPlayback,
  useDocumentStore,
  useUndoStore,
} from '@/canvas/use-document-store';
import { useCameraStore } from '@/canvas/use-camera-store';
import {
  bindAnimationRuntime,
  pauseLocalPlayback,
  playRecordingLocally,
  playbackPositionAt,
  seekLocalPlayback,
  startAnimationRecording,
  stopAnimationRecording,
  stopLocalPlayback,
} from './runtime';
import {
  applyAnimationOps,
  diffAnimationShapes,
  recordingSnapshotAt,
} from './recording';
import { useAnimationStore } from './use-animation-store';
import '@/canvas/shapes/register';

// The playback loop uses rAF, which the node test environment lacks.
globalThis.requestAnimationFrame ??= (cb: FrameRequestCallback) =>
  setTimeout(() => cb(performance.now()), 16) as unknown as number;
globalThis.cancelAnimationFrame ??= (id: number) => clearTimeout(id);

function rectangle(id: string, x = 0): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x,
    y: 0,
    rotation: 0,
    index: `a${id}`,
    props: {
      w: 20,
      h: 10,
      color: '#000000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
  };
}

function draw(points: DrawShape['props']['points']): DrawShape {
  return {
    id: 'ink',
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      points,
      isClosed: false,
      color: '#000000',
      size: 2,
    },
  };
}

function recording(
  frames: AnimationRecordingV1['frames'],
  pageId = 'page-default',
): AnimationRecordingV1 {
  return {
    version: 1,
    pageId,
    createdAt: 1,
    durationMs: 1000,
    initialShapes: [rectangle('a')],
    initialViewport: { x: 0, y: 0, z: 1, width: 800, height: 600 },
    frames,
  };
}

describe('animation shape deltas', () => {
  it('encodes creates, changes, and deletes', () => {
    const ops = diffAnimationShapes(
      [rectangle('a'), rectangle('b')],
      [rectangle('b', 25), rectangle('c')],
    );
    expect(ops.map((op) => op.type)).toEqual(['delete', 'upsert', 'upsert']);

    const shapes = new Map<string, Shape>([
      ['a', rectangle('a')],
      ['b', rectangle('b')],
    ]);
    applyAnimationOps(shapes, ops);
    expect([...shapes]).toEqual([
      ['b', rectangle('b', 25)],
      ['c', rectangle('c')],
    ]);
  });

  it('stores append-only ink as new points instead of a full shape', () => {
    const before = draw([{ x: 0, y: 0, pressure: 0.5 }]);
    const after = draw([
      { x: 0, y: 0, pressure: 0.5 },
      { x: 4, y: 2, pressure: 0.7 },
    ]);
    const ops = diffAnimationShapes([before], [after]);
    expect(ops).toEqual([
      {
        type: 'append-draw-points',
        id: 'ink',
        points: [{ x: 4, y: 2, pressure: 0.7 }],
      },
    ]);
  });

  it('reconstructs a deterministic snapshot at any timeline position', () => {
    const value = recording([
      { atMs: 200, ops: [{ type: 'upsert', shape: rectangle('b') }] },
      { atMs: 500, ops: [{ type: 'delete', id: 'a' }] },
      {
        atMs: 700,
        ops: [],
        viewport: { x: 10, y: 20, z: 2, width: 800, height: 600 },
      },
    ]);
    expect(recordingSnapshotAt(value, 350).shapes.map((shape) => shape.id)).toEqual([
      'a',
      'b',
    ]);
    const later = recordingSnapshotAt(value, 800);
    expect(later.shapes.map((shape) => shape.id)).toEqual(['b']);
    expect(later.viewport).toMatchObject({ x: 10, y: 20, z: 2 });
  });

  it('advances only while the transport is playing', () => {
    expect(
      playbackPositionAt(
        { status: 'playing', positionMs: 250, updatedAt: 1000 },
        1450,
      ),
    ).toBe(700);
    expect(
      playbackPositionAt(
        { status: 'paused', positionMs: 250, updatedAt: 1000 },
        1450,
      ),
    ).toBe(250);
  });

  it('round-trips a recording through a Yjs update', () => {
    const source = new Y.Doc();
    source
      .getMap<AnimationRecordingV1>('animations')
      .set('page-default', recording([]));
    const target = new Y.Doc();
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source));
    expect(
      target
        .getMap<AnimationRecordingV1>('animations')
        .get('page-default'),
    ).toEqual(recording([]));
    source.destroy();
    target.destroy();
  });
});

describe('animation document integration', () => {
  let dispose: () => void;

  beforeEach(() => {
    dispose = loadBoard('animation-test', { persist: false, collab: false });
    useAnimationStore.getState().setViewportSize({ width: 800, height: 600 });
  });

  afterEach(() => dispose());

  it('captures a baseline, content changes, and the final viewport atomically', () => {
    editor.createShape(rectangle('a'));
    useCameraStore.getState().setCamera({ x: 1, y: 2, z: 1 });
    expect(startAnimationRecording()).toBe(true);
    editor.createShape(rectangle('b'));
    useCameraStore.getState().setCamera({ x: 20, y: 30, z: 2 });

    const saved = stopAnimationRecording();
    expect(saved?.initialShapes.map((shape) => shape.id)).toEqual(['a']);
    expect(saved?.initialViewport).toMatchObject({ x: 1, y: 2, z: 1 });
    expect(saved?.frames.at(-1)?.viewport).toMatchObject({ x: 20, y: 30, z: 2 });
  });

  it('keeps playback transport state out of shape undo history', () => {
    expect(useUndoStore.getState().canUndo).toBe(false);
    setAnimationPlayback({
      recordingId: 'rec-1',
      status: 'paused',
      positionMs: 100,
    });
    expect(useUndoStore.getState().canUndo).toBe(false);
    expect(useAnimationStore.getState().playback).toMatchObject({
      recordingId: 'rec-1',
      status: 'paused',
      positionMs: 100,
    });
  });

  it('blocks editor mutations while the playback render is active', () => {
    useAnimationStore.getState().setPlaybackFrame({
      active: true,
      positionMs: 0,
      shapes: [],
      viewport: null,
    });
    editor.createShape(rectangle('blocked'));
    expect(useDocumentStore.getState().shapes).toEqual([]);
  });
});

describe('local playback runtime', () => {
  let dispose: () => void;
  let unbind: () => void;

  beforeEach(() => {
    dispose = loadBoard('animation-test', { persist: false, collab: false });
    useAnimationStore.getState().setViewportSize({ width: 800, height: 600 });
    unbind = bindAnimationRuntime();
  });

  afterEach(() => {
    unbind();
    dispose();
  });

  it('plays privately without touching the shared transport', () => {
    useAnimationStore.getState().addPayload('rec-1', recording([]));
    playRecordingLocally('rec-1');

    const state = useAnimationStore.getState();
    expect(state.playbackActive).toBe(true);
    expect(state.isLocalPlayback).toBe(true);
    expect(state.playbackShapes.map((shape) => shape.id)).toEqual(['a']);
    // The shared (Yjs-backed) transport never saw the local session.
    expect(state.playback.status).toBe('stopped');
    expect(state.playback.recordingId).toBeNull();
  });

  it('supports pause and seek in a local session', () => {
    useAnimationStore.getState().addPayload('rec-1', recording([]));
    playRecordingLocally('rec-1');
    pauseLocalPlayback();
    seekLocalPlayback(500);

    const state = useAnimationStore.getState();
    expect(state.localPlayback.status).toBe('paused');
    expect(state.playbackPositionMs).toBe(500);
    expect(state.playbackActive).toBe(true);
  });

  it('is preempted when shared playback starts', () => {
    useAnimationStore.getState().addPayload('rec-1', recording([]));
    playRecordingLocally('rec-1');
    expect(useAnimationStore.getState().isLocalPlayback).toBe(true);

    setAnimationPlayback({
      recordingId: 'rec-1',
      status: 'playing',
      positionMs: 0,
    });
    const state = useAnimationStore.getState();
    expect(state.playbackActive).toBe(true);
    expect(state.isLocalPlayback).toBe(false);
    expect(state.localPlayback.status).toBe('stopped');
  });

  it('survives a shared stop broadcast from another client', () => {
    useAnimationStore.getState().addPayload('rec-1', recording([]));
    playRecordingLocally('rec-1');
    setAnimationPlayback({ recordingId: null, status: 'stopped', positionMs: 0 });

    const state = useAnimationStore.getState();
    expect(state.playbackActive).toBe(true);
    expect(state.isLocalPlayback).toBe(true);
  });

  it('renders a recording whose page no longer exists and restores on stop', () => {
    const pageBefore = useDocumentStore.getState().currentPageId;
    useAnimationStore
      .getState()
      .addPayload('rec-gone', recording([], 'deleted-page'));
    playRecordingLocally('rec-gone');

    let state = useAnimationStore.getState();
    expect(state.playbackActive).toBe(true);
    expect(state.playbackShapes.map((shape) => shape.id)).toEqual(['a']);
    // Page switch no-ops for a missing page; we stay on the current page.
    expect(useDocumentStore.getState().currentPageId).toBe(pageBefore);

    stopLocalPlayback();
    state = useAnimationStore.getState();
    expect(state.playbackActive).toBe(false);
    expect(useDocumentStore.getState().currentPageId).toBe(pageBefore);
  });
});
