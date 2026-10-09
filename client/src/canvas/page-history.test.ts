import { beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MAX_HISTORY_PAGES, PageHistory, useUndoStore } from './page-history';

const LOCAL = 'local';

type Shapes = Y.Map<Y.Map<unknown>>;

// A page is just a `shapes` map in a document of its own.
function page(): Shapes {
  return new Y.Doc().getMap('shapes') as Shapes;
}

function add(shapes: Shapes, id: string, origin: string = LOCAL): void {
  shapes.doc!.transact(() => shapes.set(id, new Y.Map()), origin);
}

let pins: Map<string, number>;
let history: PageHistory;
beforeEach(() => {
  pins = new Map();
  history = new PageHistory({
    trackedOrigin: LOCAL,
    pin: (id) => pins.set(id, (pins.get(id) ?? 0) + 1),
    unpin: (id) => pins.set(id, (pins.get(id) ?? 0) - 1),
  });
});

describe('PageHistory', () => {
  it('undoes and redoes a local edit, and says when it can', () => {
    const shapes = page();
    history.open('p1', shapes);
    expect(useUndoStore.getState()).toEqual({ canUndo: false, canRedo: false });

    add(shapes, 'a');
    expect(useUndoStore.getState().canUndo).toBe(true);

    history.undo();
    expect(shapes.has('a')).toBe(false);
    expect(useUndoStore.getState()).toEqual({ canUndo: false, canRedo: true });

    history.redo();
    expect(shapes.has('a')).toBe(true);
  });

  it('leaves edits from any other origin alone', () => {
    const shapes = page();
    history.open('p1', shapes);
    add(shapes, 'peer', 'someone-else');
    expect(useUndoStore.getState().canUndo).toBe(false);
  });

  it('splits edits into steps at a capture break', () => {
    const shapes = page();
    history.open('p1', shapes);
    add(shapes, 'a');
    history.breakCapture();
    add(shapes, 'b');

    history.undo();
    expect([...shapes.keys()]).toEqual(['a']);
  });

  it('keeps each page its own history across a switch', () => {
    const one = page();
    const two = page();
    history.open('p1', one);
    add(one, 'a');

    history.open('p2', two);
    expect(useUndoStore.getState().canUndo).toBe(false);
    history.undo();
    expect(one.has('a')).toBe(true);

    history.open('p1', one);
    expect(useUndoStore.getState().canUndo).toBe(true);
    history.undo();
    expect(one.has('a')).toBe(false);
  });

  it('holds an edited page resident, once', () => {
    const shapes = page();
    history.open('p1', shapes);
    expect(pins.get('p1')).toBeUndefined();
    add(shapes, 'a');
    history.breakCapture();
    add(shapes, 'b');
    expect(pins.get('p1')).toBe(1);
  });

  it('lets the least recently edited page go past the limit', () => {
    for (let i = 0; i <= MAX_HISTORY_PAGES; i++) {
      const shapes = page();
      history.open(`p${i}`, shapes);
      add(shapes, 'a');
    }
    expect(pins.get('p0')).toBe(0);
    expect(pins.get('p1')).toBe(1);
    expect(pins.get(`p${MAX_HISTORY_PAGES}`)).toBe(1);
  });

  it('forgets a released page', () => {
    const shapes = page();
    history.open('p1', shapes);
    add(shapes, 'a');
    history.release('p1');

    history.open('p1', shapes);
    expect(useUndoStore.getState().canUndo).toBe(false);
  });

  describe('a move to another page', () => {
    function move(source: Shapes, target: Shapes, id: string): void {
      history.recordMove(
        'target',
        () => {
          target.doc!.transact(() => target.set(id, new Y.Map()), 'cross-page');
          source.doc!.transact(() => source.delete(id), LOCAL);
        },
        (direction) => {
          if (direction === 'undo') target.delete(id);
          else target.set(id, new Y.Map());
        },
      );
    }

    it('undoes and redoes both halves as one step', () => {
      const source = page();
      const target = page();
      history.open('source', source);
      add(source, 'a');
      move(source, target, 'a');
      expect(source.has('a')).toBe(false);
      expect(target.has('a')).toBe(true);

      history.undo();
      expect(source.has('a')).toBe(true);
      expect(target.has('a')).toBe(false);

      history.redo();
      expect(source.has('a')).toBe(false);
      expect(target.has('a')).toBe(true);

      // The payload follows the entry back onto the undo stack.
      history.undo();
      expect(source.has('a')).toBe(true);
      expect(target.has('a')).toBe(false);
    });

    it('does not merge with the edit before it', () => {
      const source = page();
      const target = page();
      history.open('source', source);
      add(source, 'a');
      move(source, target, 'a');

      history.undo();
      expect(source.has('a')).toBe(true);
      history.undo();
      expect(source.has('a')).toBe(false);
    });

    it('holds the target for as long as the source has history', () => {
      const source = page();
      const target = page();
      history.open('source', source);
      add(source, 'a');
      move(source, target, 'a');
      expect(pins.get('target')).toBe(1);

      history.release('source');
      expect(pins.get('target')).toBe(0);
    });
  });
});
