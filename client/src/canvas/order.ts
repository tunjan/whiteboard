import { generateKeyBetween } from 'fractional-indexing';
import type { Shape } from '@whiteboard/shared';

/**
 * Fractional z-order keys. Inserting "between" two keys never renumbers the
 * others, so concurrent reordering under the CRDT stays conflict-free.
 */

/** A key strictly above every shape's index (i.e. on top). */
export function getTopIndex(shapes: readonly Shape[]): string {
  let max: string | null = null;
  for (const s of shapes) {
    if (max === null || s.index > max) max = s.index;
  }
  return generateKeyBetween(max, null);
}

/** A key strictly below every shape's index (i.e. at the back). */
export function getBottomIndex(shapes: readonly Shape[]): string {
  let min: string | null = null;
  for (const s of shapes) {
    if (min === null || s.index < min) min = s.index;
  }
  return generateKeyBetween(null, min);
}

export { generateKeyBetween };
