import type { DrawPoint, Shape } from './shapes/shapes';

/** Camera and viewport size captured together so playback can fit every screen. */
export interface RecordedViewport {
  x: number;
  y: number;
  z: number;
  width: number;
  height: number;
}

export type AnimationOp =
  | { type: 'upsert'; shape: Shape }
  | { type: 'delete'; id: string }
  | { type: 'append-draw-points'; id: string; points: DrawPoint[] };

export interface AnimationFrame {
  /** Milliseconds since recording started. */
  atMs: number;
  ops: AnimationOp[];
  viewport?: RecordedViewport;
}

/** Versioned, persistent recording stored server-side as one JSON payload. */
export interface AnimationRecordingV1 {
  version: 1;
  pageId: string;
  createdAt: number;
  durationMs: number;
  initialShapes: Shape[];
  initialViewport: RecordedViewport;
  frames: AnimationFrame[];
}

export type AnimationPlaybackStatus = 'stopped' | 'playing' | 'paused';

/** Shared transport state. Position advances from updatedAt while playing. */
export interface AnimationPlaybackState {
  recordingId: string | null;
  status: AnimationPlaybackStatus;
  positionMs: number;
  updatedAt: number;
  version: number;
}

export const DEFAULT_ANIMATION_PLAYBACK: AnimationPlaybackState = {
  recordingId: null,
  status: 'stopped',
  positionMs: 0,
  updatedAt: 0,
  version: 0,
};

export function isAnimationRecording(value: unknown): value is AnimationRecordingV1 {
  if (!value || typeof value !== 'object') return false;
  const recording = value as Partial<AnimationRecordingV1>;
  return (
    recording.version === 1 &&
    typeof recording.pageId === 'string' &&
    typeof recording.createdAt === 'number' &&
    typeof recording.durationMs === 'number' &&
    Array.isArray(recording.initialShapes) &&
    Array.isArray(recording.frames) &&
    !!recording.initialViewport
  );
}
