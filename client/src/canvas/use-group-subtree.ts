import type { Shape } from '@whiteboard/shared';
import { shapeStore } from './engine/shape-store';
import { descendantsOf } from './hierarchy';
import { shallowArrayEqual, useStoreValue } from './use-shapes';

/** Stable empty result for the common, group-free case. */
const NO_SHAPES: Shape[] = [];

/**
 * The descendants of whichever of `ids` are groups — everything a group's box
 * or outline reads from the page, since that box is the union of its subtree.
 *
 * Selecting the subtree rather than the whole page is what keeps a group off
 * the per-edit path: the result is compared shape by shape, so its layer
 * re-renders when one of the group's own shapes changes, not when anything on
 * the page does. The child index behind `descendantsOf` is cached on the page
 * array, so every caller shares one pass per edit.
 */
export function useGroupSubtree(ids: readonly string[]): Shape[] {
  return useStoreValue(
    () => {
      let out: Shape[] | null = null;
      for (const id of ids) {
        if (shapeStore.record(id).get()?.type !== 'group') continue;
        (out ??= []).push(...descendantsOf(shapeStore.sorted.get(), id));
      }
      return out ?? NO_SHAPES;
    },
    // Callers build `ids` inline, so key on its contents, not its identity.
    [ids.join('\u0000')],
    shallowArrayEqual,
  );
}
