import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readShapeBase, SHAPE_BASE_KEY } from '@whiteboard/shared';
import { migrateShapes } from './migrate-shapes';

function legacyShape(fields: Record<string, unknown>): Y.Map<unknown> {
  const m = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(fields)) m.set(key, value);
  return m;
}

describe('migrateShapes', () => {
  it('packs per-field entries into one and drops them', () => {
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes:p2');
    shapes.set(
      'a',
      legacyShape({
        id: 'a',
        type: 'rectangle',
        x: 1,
        y: 2,
        rotation: 0,
        index: 'a0',
        parentId: null,
        opacity: 0.5,
        props: { w: 10 },
      }),
    );

    expect(migrateShapes(doc)).toEqual({ migrated: 1, current: 0 });
    const m = shapes.get('a')!;
    expect([...m.keys()].sort()).toEqual([SHAPE_BASE_KEY, 'props']);
    expect(readShapeBase(m)).toEqual({
      id: 'a',
      type: 'rectangle',
      x: 1,
      y: 2,
      rotation: 0,
      index: 'a0',
      parentId: null,
      opacity: 0.5,
    });
    expect(m.get('props')).toEqual({ w: 10 });

    expect(migrateShapes(doc)).toEqual({ migrated: 0, current: 1 });
  });

  it('keeps an existing packed base over per-field leftovers', () => {
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes');
    const packed = ['a', 'draw', 5, 5, 0, 'a1'];
    shapes.set('a', legacyShape({ [SHAPE_BASE_KEY]: packed, x: 1 }));

    expect(migrateShapes(doc).migrated).toBe(1);
    expect(shapes.get('a')!.get(SHAPE_BASE_KEY)).toEqual(packed);
    expect(shapes.get('a')!.has('x')).toBe(false);
  });

  it('leaves other root maps alone', () => {
    const doc = new Y.Doc();
    doc.getMap<Y.Map<unknown>>('pages').set('p', legacyShape({ id: 'p', index: 'a0' }));
    expect(migrateShapes(doc)).toEqual({ migrated: 0, current: 0 });
    expect(doc.getMap<Y.Map<unknown>>('pages').get('p')!.get('id')).toBe('p');
  });
});
