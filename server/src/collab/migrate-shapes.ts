import * as Y from 'yjs';
import {
  packShapeBase,
  SHAPE_BASE_FIELDS,
  SHAPE_BASE_KEY,
} from '@whiteboard/shared';

/**
 * One-time rewrite of every shape's base fields (id, type, x, y, rotation,
 * index, parentId, locked, hidden, opacity) from one Y.Map entry each into the
 * single packed entry at `SHAPE_BASE_KEY`. The client reads only the packed
 * form; this is the only code that still reads the old one.
 *
 * Shapes live in root maps named `shapes` or `shapes:<pageId>`, as in
 * migrate-ink.ts.
 */

function isShapesMap(name: string): boolean {
  return name === 'shapes' || name.startsWith('shapes:');
}

export interface ShapeMigrationResult {
  /** Shapes rewritten into the packed form. */
  migrated: number;
  /** Shapes already packed, left untouched. */
  current: number;
}

/**
 * Rewrite every unpacked shape in `doc` in one transaction. Idempotent: a
 * packed shape with no per-field entries left is not written to.
 */
export function migrateShapes(doc: Y.Doc): ShapeMigrationResult {
  const result: ShapeMigrationResult = { migrated: 0, current: 0 };
  const names = [...doc.share.keys()].filter(isShapesMap);
  doc.transact(() => {
    for (const name of names) {
      for (const shape of doc.getMap<unknown>(name).values()) {
        if (!(shape instanceof Y.Map)) continue;
        const stale = SHAPE_BASE_FIELDS.filter((field) => shape.has(field));
        if (stale.length === 0) {
          if (shape.has(SHAPE_BASE_KEY)) result.current++;
          continue;
        }
        // Already packed with per-field leftovers: the packed copy is the one
        // the client has been writing to.
        if (!shape.has(SHAPE_BASE_KEY)) {
          shape.set(
            SHAPE_BASE_KEY,
            packShapeBase((field) => shape.get(field)),
          );
        }
        for (const field of stale) shape.delete(field);
        result.migrated++;
      }
    }
  });
  return result;
}
