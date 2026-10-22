import * as Y from 'yjs';
import {
  packShapeBase,
  readShapeBase,
  SHAPE_BASE_KEY,
  type DrawPoint,
  type GraphExpression,
  type Shape,
} from '@whiteboard/shared';
import type { ShapePatch } from './editor';
import type { YShape } from './page-derived';
import {
  compactYPoints,
  encodePointsForStorage,
  ensurePointsArray,
  syncYPoints,
} from './shapes/ink-points';
import {
  encodeGraphExpressionsForStorage,
  ensureGraphExpressionsArray,
  syncYGraphExpressions,
} from './shapes/graph-storage';

// Plain shape -> Yjs writes. The read direction, `yToShape`, is in
// page-derived.ts.

export function shapeToY(shape: Shape): YShape {
  const m = new Y.Map<unknown>();
  m.set(
    SHAPE_BASE_KEY,
    packShapeBase((field) => shape[field as keyof Shape]),
  );
  if (shape.type === 'text') {
    // Text is a sequence CRDT, not a scalar property. Concurrent insert/delete
    // operations then merge by character identity instead of overwriting the
    // entire string with whichever client wrote last.
    const { text, ...props } = shape.props;
    m.set('props', props);
    m.set('text', new Y.Text(text));
  } else if (shape.type === 'draw') {
    // Ink points are a growing sequence, for the same reason text is one. A
    // stroke is written once per frame while it is drawn; storing the array
    // inside `props` re-encoded the whole array each time, so an n-point stroke
    // cost O(n²) document bytes — paid by every peer and kept forever. As a
    // Y.Array the live path appends only the new points: O(n) for the stroke.
    const { points, ...props } = shape.props;
    m.set('props', props);
    // Fixed-point varint chunks: see ink-points.ts.
    m.set('points', Y.Array.from(encodePointsForStorage(points)));
  } else if (shape.type === 'graph') {
    // One Y.Map per curve, so collaborators editing different rows of the same
    // plot don't overwrite each other. See graph-storage.ts.
    const { expressions, ...props } = shape.props;
    m.set('props', props);
    m.set(
      'expressions',
      Y.Array.from(encodeGraphExpressionsForStorage(expressions)),
    );
  } else {
    m.set('props', shape.props);
  }
  return m;
}

/** Apply the smallest contiguous replacement between two strings to Y.Text. */
function syncYText(text: Y.Text, next: string): void {
  const current = text.toString();
  if (current === next) return;

  let prefix = 0;
  const limit = Math.min(current.length, next.length);
  while (prefix < limit && current[prefix] === next[prefix]) prefix++;

  let suffix = 0;
  while (
    suffix < current.length - prefix &&
    suffix < next.length - prefix &&
    current[current.length - 1 - suffix] === next[next.length - 1 - suffix]
  ) {
    suffix++;
  }

  const remove = current.length - prefix - suffix;
  if (remove > 0) text.delete(prefix, remove);
  const insert = next.slice(prefix, next.length - suffix);
  if (insert) text.insert(prefix, insert);
}

function sameProps(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && a[key] === b[key])
  );
}

const PATCHABLE_BASE_FIELDS = [
  'x',
  'y',
  'rotation',
  'index',
  'parentId',
  'locked',
  'hidden',
  'opacity',
] as const;

export function applyPatchToY(m: YShape, patch: ShapePatch): void {
  const base = readShapeBase(m)!;
  // Written whole, and only when a field actually changed: a Y.Map set is never
  // free, even with the value it already holds — it emits a new item to every
  // peer and leaves the old one behind as a tombstone.
  let nextBase: Record<string, unknown> | null = null;
  for (const field of PATCHABLE_BASE_FIELDS) {
    const value = patch[field];
    if (value !== undefined && base[field] !== value) {
      (nextBase ??= { ...base })[field] = value;
    }
  }
  if (nextBase) {
    const fields = nextBase;
    m.set(SHAPE_BASE_KEY, packShapeBase((field) => fields[field]));
  }
  if (patch.props) {
    const type = base.type;
    const nextProps = { ...patch.props };
    if (type === 'text' && typeof nextProps.text === 'string') {
      const existing = m.get('text');
      let text: Y.Text;
      if (existing instanceof Y.Text) {
        text = existing;
      } else {
        const legacy = m.get('props') as { text?: unknown } | undefined;
        text = new Y.Text(typeof legacy?.text === 'string' ? legacy.text : '');
        m.set('text', text);
      }
      syncYText(text, nextProps.text);
      delete nextProps.text;
    }
    if (type === 'draw' && Array.isArray(nextProps.points)) {
      const arr = ensurePointsArray(m);
      const points = nextProps.points as DrawPoint[];
      syncYPoints(arr, points);
      // The stroke is finished, so its per-frame chunks can be merged.
      if (nextProps.isComplete === true) compactYPoints(arr, points);
      delete nextProps.points;
    }
    if (type === 'graph' && Array.isArray(nextProps.expressions)) {
      syncYGraphExpressions(
        ensureGraphExpressionsArray(m),
        nextProps.expressions as GraphExpression[],
      );
      delete nextProps.expressions;
    }
    if (Object.keys(nextProps).length > 0) {
      const current =
        (m.get('props') as Record<string, unknown> | undefined) ?? {};
      const merged = { ...current, ...nextProps };
      // An image's (or uploaded video's) blob id only ever goes from ''
      // (upload pending) to set. A gesture that began before the upload landed
      // writes back the props it snapshotted, '' included, which would strand
      // every peer on the placeholder for good.
      if ((type === 'image' || type === 'video') && current.blobId && !merged.blobId) {
        merged.blobId = current.blobId;
        if (current.thumbBlobId && !merged.thumbBlobId)
          merged.thumbBlobId = current.thumbBlobId;
        if (current.posterBlobId && !merged.posterBlobId)
          merged.posterBlobId = current.posterBlobId;
      }
      // Once a legacy shape has a Y.Text, remove its stale scalar copy.
      if (type === 'text' && m.get('text') instanceof Y.Text) {
        delete merged.text;
      }
      if (
        type === 'graph' &&
        m.get('expressions') instanceof Y.Array
      ) {
        delete merged.expressions;
      }
      // The live draw tool re-sends `isComplete: false` on every write; without
      // this check each one re-broadcast the whole props object.
      if (!sameProps(merged, current)) m.set('props', merged);
    }
  }
}
