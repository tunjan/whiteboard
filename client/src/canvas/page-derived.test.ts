import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  packShapeBase,
  readShapeBase,
  SHAPE_BASE_FIELDS,
  SHAPE_BASE_KEY,
} from '@whiteboard/shared';
import './shapes/register';
import {
  PageDerivedState,
  collectTouchedShapeIds,
  type YShape,
} from './page-derived';

// A page is just a `shapes` map in a document: no board session, no storage.
function page(): Y.Map<YShape> {
  return new Y.Doc().getMap<YShape>('shapes');
}

function put(
  shapes: Y.Map<YShape>,
  id: string,
  index: string,
  extra: Record<string, unknown> = {},
): void {
  const m = new Y.Map<unknown>();
  const base: Record<string, unknown> = {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index,
  };
  for (const [key, value] of Object.entries(extra)) {
    if ((SHAPE_BASE_FIELDS as readonly string[]).includes(key)) {
      base[key] = value;
      delete extra[key];
    }
  }
  m.set(
    SHAPE_BASE_KEY,
    packShapeBase((field) => base[field]),
  );
  m.set('props', {
    w: 10,
    h: 10,
    color: '#000000',
    fillStyle: 'none',
    dash: 'solid',
    size: 2,
  });
  for (const [key, value] of Object.entries(extra)) m.set(key, value);
  shapes.set(id, m);
}

/** What a client's `updateShape` writes for a change to base fields. */
function setBase(m: YShape, fields: Record<string, unknown>): void {
  const next = { ...readShapeBase(m), ...fields } as Record<string, unknown>;
  m.set(
    SHAPE_BASE_KEY,
    packShapeBase((field) => next[field]),
  );
}

const ids = (derived: PageDerivedState) =>
  derived.sortedShapes().map((s) => s.id);

describe('PageDerivedState', () => {
  it('derives shapes, order, index and counts from a page', () => {
    const shapes = page();
    put(shapes, 'b', 'a2');
    put(shapes, 'a', 'a1');
    put(shapes, 'g', 'a3', { type: 'group', props: {} });
    put(shapes, 'child', 'a4', { parentId: 'g' });

    const derived = new PageDerivedState();
    derived.rebuild(shapes);

    expect(ids(derived)).toEqual(['a', 'b', 'g', 'child']);
    expect(derived.shapes.get('a')?.type).toBe('rectangle');
    expect(derived.index.has('a')).toBe(true);
    // Groups have no geometry of their own.
    expect(derived.index.has('g')).toBe(false);
    expect(derived.hasHierarchy).toBe(true);
    expect(derived.hasEquations).toBe(false);
  });

  it('breaks an index tie on id, the same on every client', () => {
    const shapes = page();
    put(shapes, 'z', 'a1');
    put(shapes, 'y', 'a1');
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    expect(ids(derived)).toEqual(['y', 'z']);
  });

  it('patches an edit in place, under a new array', () => {
    const shapes = page();
    put(shapes, 'a', 'a1');
    put(shapes, 'b', 'a2');
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    const before = derived.sortedShapes();
    const minX = derived.index.getBounds('a')!.minX;

    setBase(shapes.get('a')!, { x: 50 });
    expect(derived.patch(shapes, ['a'])).toEqual([]);

    expect(derived.sortedShapes()).not.toBe(before);
    expect(ids(derived)).toEqual(['a', 'b']);
    expect(derived.sortedShapes()[0]!.x).toBe(50);
    expect(derived.index.getBounds('a')?.minX).toBe(minX + 50);
  });

  it('adds, re-indexes and removes shapes without losing the order', () => {
    const shapes = page();
    put(shapes, 'a', 'a1');
    put(shapes, 'b', 'a2');
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    derived.sortedShapes();

    put(shapes, 'c', 'a0');
    setBase(shapes.get('a')!, { index: 'a3' });
    shapes.delete('b');
    const removed = derived.patch(shapes, ['a', 'b', 'c']);

    expect(removed.map((s) => s.id)).toEqual(['b']);
    expect(ids(derived)).toEqual(['c', 'a']);
    expect(derived.shapes.has('b')).toBe(false);
    expect(derived.index.has('b')).toBe(false);
  });

  it('stays ordered when a batch is too large to splice', () => {
    const shapes = page();
    put(shapes, 'first', 'a0');
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    derived.sortedShapes();

    const added: string[] = [];
    for (let i = 40; i > 0; i--) {
      const id = `s${String(i).padStart(2, '0')}`;
      put(shapes, id, `b${String(i).padStart(2, '0')}`);
      added.push(id);
    }
    derived.patch(shapes, added);

    expect(ids(derived)).toEqual(['first', ...added.reverse()]);
  });

  it('keeps the counts in step with parenting changes', () => {
    const shapes = page();
    put(shapes, 'a', 'a1', { parentId: 'f' });
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    expect(derived.hasHierarchy).toBe(true);

    shapes.delete('a');
    derived.patch(shapes, ['a']);
    expect(derived.hasHierarchy).toBe(false);
  });

  it('tracks an arrow bound to a shape, and drops it with the arrow', () => {
    const shapes = page();
    put(shapes, 'target', 'a1');
    put(shapes, 'arrow', 'a2', {
      type: 'arrow',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        bindings: { end: { shapeId: 'target' } },
      },
    });
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    expect(derived.bindings.arrowsBoundTo('target')).toEqual(['arrow']);

    shapes.delete('arrow');
    derived.patch(shapes, ['arrow']);
    expect(derived.bindings.isEmpty).toBe(true);
  });

  it('hands a page over whole, keeping its own index identity', () => {
    const shapes = page();
    put(shapes, 'a', 'a1', { parentId: 'f' });
    const active = new PageDerivedState();
    active.rebuild(shapes);
    const index = active.index;
    const cache = active.shapes;

    const parked = new PageDerivedState();
    parked.adopt(active);

    expect(active.shapes.size).toBe(0);
    expect(active.shapes).not.toBe(cache);
    expect(active.index.size).toBe(0);
    expect(active.hasHierarchy).toBe(false);
    expect(ids(active)).toEqual([]);
    expect(parked.shapes).toBe(cache);
    expect(parked.hasHierarchy).toBe(true);

    active.adopt(parked);
    expect(active.index).toBe(index);
    expect(active.index.has('a')).toBe(true);
    expect(ids(active)).toEqual(['a']);
  });

  it('catches a parked page up on what changed while it was away', () => {
    const shapes = page();
    for (const id of ['a', 'b', 'c', 'd']) put(shapes, id, `a${id}`);
    const active = new PageDerivedState();
    active.rebuild(shapes);
    const parked = new PageDerivedState();
    parked.adopt(active);

    const dirty = new Set<string>();
    shapes.observeDeep((events) =>
      collectTouchedShapeIds(events, shapes, dirty),
    );
    setBase(shapes.get('a')!, { x: 7 });

    expect(parked.canPatch(dirty.size)).toBe(true);
    active.adopt(parked);
    active.patch(shapes, dirty);
    expect(active.shapes.get('a')?.x).toBe(7);
  });

  it('prefers a rebuild once more than a quarter of the page changed', () => {
    const shapes = page();
    for (const id of ['a', 'b', 'c', 'd']) put(shapes, id, `a${id}`);
    const derived = new PageDerivedState();
    derived.rebuild(shapes);
    expect(derived.canPatch(1)).toBe(true);
    expect(derived.canPatch(2)).toBe(false);
  });
});

describe('collectTouchedShapeIds', () => {
  function watch(shapes: Y.Map<YShape>) {
    const touched = new Set<string>();
    const content = new Set<string>();
    shapes.observeDeep((events) =>
      collectTouchedShapeIds(events, shapes, touched, content),
    );
    return { touched, content };
  }

  it('reports added and removed shapes', () => {
    const shapes = page();
    const { touched, content } = watch(shapes);
    put(shapes, 'a', 'a1');
    shapes.delete('a');
    expect([...touched]).toEqual(['a']);
    expect(content.size).toBe(0);
  });

  it('tells a move from a content change', () => {
    const shapes = page();
    put(shapes, 'a', 'a1');
    put(shapes, 'b', 'a2');
    const { touched, content } = watch(shapes);

    setBase(shapes.get('a')!, { x: 5 });
    shapes.get('b')!.set('props', { w: 20 });

    expect([...touched].sort()).toEqual(['a', 'b']);
    expect([...content]).toEqual(['b']);
  });

  it('counts an edit inside a nested sequence as content', () => {
    const shapes = page();
    put(shapes, 't', 'a1', { type: 'text', text: new Y.Text('hi') });
    const { content } = watch(shapes);
    (shapes.get('t')!.get('text') as Y.Text).insert(2, '!');
    expect([...content]).toEqual(['t']);
  });
});
