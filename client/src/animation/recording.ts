import type {
  AnimationFrame,
  AnimationOp,
  AnimationRecordingV1,
  DrawPoint,
  RecordedViewport,
  Shape,
} from '@whiteboard/shared';

function cloneShape(shape: Shape): Shape {
  return structuredClone(shape);
}

function cloneShapes(shapes: readonly Shape[]): Shape[] {
  return shapes.map(cloneShape);
}

function equalJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function appendedDrawPoints(previous: Shape, next: Shape): DrawPoint[] | null {
  if (previous.type !== 'draw' || next.type !== 'draw') return null;
  const { points: previousPoints, ...previousProps } = previous.props;
  const { points: nextPoints, ...nextProps } = next.props;
  if (
    !equalJson({ ...previous, props: previousProps }, { ...next, props: nextProps }) ||
    nextPoints.length < previousPoints.length
  ) {
    return null;
  }
  for (let i = 0; i < previousPoints.length; i++) {
    if (!equalJson(previousPoints[i], nextPoints[i])) return null;
  }
  return nextPoints.slice(previousPoints.length).map((point) => ({ ...point }));
}

/** Build compact operations that transform previous into next. */
export function diffAnimationShapes(
  previous: readonly Shape[],
  next: readonly Shape[],
): AnimationOp[] {
  const before = new Map(previous.map((shape) => [shape.id, shape]));
  const after = new Map(next.map((shape) => [shape.id, shape]));
  const ops: AnimationOp[] = [];

  for (const shape of previous) {
    if (!after.has(shape.id)) ops.push({ type: 'delete', id: shape.id });
  }
  for (const shape of next) {
    const prior = before.get(shape.id);
    if (!prior) {
      ops.push({ type: 'upsert', shape: cloneShape(shape) });
      continue;
    }
    if (prior === shape || equalJson(prior, shape)) continue;
    const appended = appendedDrawPoints(prior, shape);
    if (appended?.length) {
      ops.push({ type: 'append-draw-points', id: shape.id, points: appended });
    } else {
      ops.push({ type: 'upsert', shape: cloneShape(shape) });
    }
  }
  return ops;
}

export function applyAnimationOps(
  shapes: Map<string, Shape>,
  ops: readonly AnimationOp[],
): void {
  for (const op of ops) {
    if (op.type === 'delete') {
      shapes.delete(op.id);
    } else if (op.type === 'upsert') {
      shapes.set(op.shape.id, cloneShape(op.shape));
    } else {
      const shape = shapes.get(op.id);
      if (shape?.type !== 'draw') continue;
      shapes.set(op.id, {
        ...shape,
        props: {
          ...shape.props,
          points: [...shape.props.points, ...op.points.map((point) => ({ ...point }))],
        },
      });
    }
  }
}

export interface PlaybackSnapshot {
  shapes: Shape[];
  viewport: RecordedViewport;
  nextFrameIndex: number;
}

/** Deterministically reconstruct any point in a recording. */
export function recordingSnapshotAt(
  recording: AnimationRecordingV1,
  positionMs: number,
): PlaybackSnapshot {
  const shapes = new Map(
    cloneShapes(recording.initialShapes).map((shape) => [shape.id, shape]),
  );
  let viewport = { ...recording.initialViewport };
  let nextFrameIndex = 0;
  while (
    nextFrameIndex < recording.frames.length &&
    recording.frames[nextFrameIndex]!.atMs <= positionMs
  ) {
    const frame = recording.frames[nextFrameIndex]!;
    applyAnimationOps(shapes, frame.ops);
    if (frame.viewport) viewport = { ...frame.viewport };
    nextFrameIndex++;
  }
  return {
    shapes: [...shapes.values()].sort((a, b) =>
      a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
    ),
    viewport,
    nextFrameIndex,
  };
}

export function createRecording(args: {
  pageId: string;
  createdAt: number;
  durationMs: number;
  initialShapes: readonly Shape[];
  initialViewport: RecordedViewport;
  frames: AnimationFrame[];
}): AnimationRecordingV1 {
  return {
    version: 1,
    pageId: args.pageId,
    createdAt: args.createdAt,
    durationMs: Math.max(0, args.durationMs),
    initialShapes: cloneShapes(args.initialShapes),
    initialViewport: { ...args.initialViewport },
    frames: structuredClone(args.frames),
  };
}
