import { computed, react } from '@tldraw/state';
import type { Shape } from '@whiteboard/shared';
import { useMemo } from 'react';
import { shapeStore } from './engine/shape-store';
import { useSignalValue } from './engine/use-signal';

/**
 * React's view of `shapeStore`. Each hook subscribes to the atoms it actually
 * read, so an edit re-renders the components looking at that shape and no
 * others — where a zustand selector re-ran on every publish of every shape.
 */

/** The published shape `id`, or undefined when absent or `id` is null. */
export function useShape(id: string | null | undefined): Shape | undefined {
  return useStoreValue(() => (id ? shapeStore.record(id).get() : undefined), [id]);
}

/**
 * The published shapes among `ids`, keyed by id — absent ids are left out.
 * Re-renders only when one of those shapes changes.
 */
export function useShapesById(ids: readonly string[]): Record<string, Shape> {
  return useStoreValue(
    () => {
      const out: Record<string, Shape> = {};
      for (const id of ids) {
        const shape = shapeStore.record(id).get();
        if (shape) out[id] = shape;
      }
      return out;
    },
    // Often built inline by the caller, so key on contents, not identity.
    [ids.join('\u0000')],
    shallowRecordEqual,
  );
}

function shallowRecordEqual<T>(
  a: Record<string, T>,
  b: Record<string, T>,
): boolean {
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

/** The current page's published shapes, z-sorted. */
export function useShapes(): Shape[] {
  return useSignalValue(shapeStore.sorted);
}

/**
 * A value derived from the store, recomputed when an atom it read changes and
 * re-rendering only when the result differs by `isEqual` (default `Object.is`).
 *
 * `deps` are the React values `fn` closes over, as for `useMemo`.
 */
export function useStoreValue<T>(
  fn: () => T,
  deps: readonly unknown[],
  isEqual?: (a: T, b: T) => boolean,
): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const signal = useMemo(() => computed('store value', fn, { isEqual }), deps);
  return useSignalValue(signal);
}

/**
 * Subscribe `listener` to every publish of the store — for imperative readers
 * (the minimap, anchored popovers) that re-derive on any shape change.
 */
export function subscribeShapes(listener: () => void): () => void {
  let first = true;
  return react('shape store subscription', () => {
    shapeStore.sorted.get();
    if (!first) listener();
    first = false;
  });
}

/** Element-wise `Object.is` over two arrays, for list-valued `useStoreValue`. */
export function shallowArrayEqual<T>(a: readonly T[], b: readonly T[]): boolean {
  return a === b || (a.length === b.length && a.every((v, i) => Object.is(v, b[i])));
}
