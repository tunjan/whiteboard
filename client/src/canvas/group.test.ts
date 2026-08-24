import { describe, expect, it } from 'vitest';
import { generateNKeysBetween } from 'fractional-indexing';
import type { Shape } from '@whiteboard/shared';
import {
  deleteShapesWithCleanup,
  duplicateShapes,
  groupShapes,
  pruneDegenerateGroups,
  ungroupShapes,
} from './commands';
import type { Editor } from './editor';
import { findClosestCommonContainer, findCommonAncestor } from './hierarchy';

interface Spec {
  id: string;
  type?: Shape['type'];
  parentId?: string | null;
}

/** In-memory editor with the parentId/index bits the group commands touch. */
function makeEditor(specs: Spec[]): Editor {
  const keys = generateNKeysBetween(null, null, specs.length);
  const map = new Map<string, Shape>();
  specs.forEach((spec, i) => {
    map.set(spec.id, {
      id: spec.id,
      type: spec.type ?? 'rectangle',
      x: 0,
      y: 0,
      rotation: 0,
      index: keys[i]!,
      parentId: spec.parentId ?? null,
      props: {},
    } as unknown as Shape);
  });
  return {
    getShape: (id) => map.get(id),
    getShapes: () =>
      [...map.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      ),
    createShape: (s) => void map.set(s.id, s),
    updateShape: (id, patch) => {
      const s = map.get(id);
      if (s) map.set(id, { ...s, ...patch } as Shape);
    },
    deleteShapes: (ids) => ids.forEach((id) => map.delete(id)),
    transact: (fn) => fn(),
  };
}

const order = (editor: Editor): string[] => editor.getShapes().map((s) => s.id);
const parentOf = (editor: Editor, id: string): string | null | undefined =>
  editor.getShape(id)?.parentId;

describe('findCommonAncestor', () => {
  it('returns the innermost container shared by every shape', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'g', type: 'group', parentId: 'frame' },
      { id: 'a', parentId: 'g' },
      { id: 'b', parentId: 'g' },
      { id: 'c', parentId: 'frame' },
    ]);
    expect(findCommonAncestor(editor.getShape, ['a', 'b'])).toBe('g');
    expect(findCommonAncestor(editor.getShape, ['a', 'c'])).toBe('frame');
  });

  it('returns null when the shapes share only the page', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b' },
    ]);
    expect(findCommonAncestor(editor.getShape, ['a', 'b'])).toBeNull();
  });

  it('survives a parent cycle instead of hanging', () => {
    const editor = makeEditor([
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]);
    expect(findCommonAncestor(editor.getShape, ['a', 'b'])).toBeDefined();
  });
});

describe('findClosestCommonContainer', () => {
  it('includes a frame target itself when paired with its descendant', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'child', parentId: 'frame' },
    ]);
    expect(
      findClosestCommonContainer(editor.getShape, ['frame', 'child']),
    ).toBe('frame');
  });

  it('returns the shared outer frame for targets in two nested branches', () => {
    const editor = makeEditor([
      { id: 'outer', type: 'frame' },
      { id: 'left', type: 'frame', parentId: 'outer' },
      { id: 'right', type: 'frame', parentId: 'outer' },
      { id: 'a', parentId: 'left' },
      { id: 'b', parentId: 'right' },
    ]);
    expect(findClosestCommonContainer(editor.getShape, ['a', 'b'])).toBe(
      'outer',
    );
  });
});

describe('groupShapes', () => {
  it('needs at least two shapes', () => {
    const editor = makeEditor([{ id: 'a' }]);
    expect(groupShapes(editor, ['a'])).toBeNull();
  });

  it('creates the group inside the members shared container', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b', parentId: 'frame' },
    ]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    // The members stay in the frame, via the group.
    expect(parentOf(editor, gid)).toBe('frame');
    expect(parentOf(editor, 'a')).toBe(gid);
    expect(parentOf(editor, 'b')).toBe(gid);
  });

  it('parents the group to the page when the members do not share a container', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b' },
    ]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    expect(parentOf(editor, gid)).toBeNull();
  });

  it('takes the z-slot of its topmost member instead of the top of the page', () => {
    const editor = makeEditor([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
      { id: 'top' },
    ]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    // Directly above 'b' (the topmost member), still below 'c' and 'top'.
    expect(order(editor)).toEqual(['a', 'b', gid, 'c', 'top']);
  });

  it('nests: grouping a group with a shape', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const inner = groupShapes(editor, ['a', 'b'])!;
    const outer = groupShapes(editor, [inner, 'c'])!;
    expect(parentOf(editor, inner)).toBe(outer);
    expect(parentOf(editor, 'a')).toBe(inner);
  });
});

describe('ungroupShapes', () => {
  it('promotes children to the group parent and deletes the group', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b', parentId: 'frame' },
    ]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    const freed = ungroupShapes(editor, [gid]);
    expect(freed.sort()).toEqual(['a', 'b']);
    expect(editor.getShape(gid)).toBeUndefined();
    // Back in the frame they came from, not on the page.
    expect(parentOf(editor, 'a')).toBe('frame');
    expect(parentOf(editor, 'b')).toBe('frame');
  });

  it('ignores ids that are not groups', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }]);
    expect(ungroupShapes(editor, ['a'])).toEqual([]);
    expect(editor.getShape('a')).toBeDefined();
  });
});

describe('pruneDegenerateGroups', () => {
  it('deletes a group left with no children', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    editor.deleteShapes(['a', 'b']);
    expect(pruneDegenerateGroups(editor, [gid])).toEqual([gid]);
    expect(editor.getShape(gid)).toBeUndefined();
  });

  it('dissolves a group left with one child, promoting it to the group parent', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b', parentId: 'frame' },
    ]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    editor.deleteShapes(['b']);
    pruneDegenerateGroups(editor, [gid]);
    expect(editor.getShape(gid)).toBeUndefined();
    expect(parentOf(editor, 'a')).toBe('frame');
  });

  it('cascades upward when dissolving empties the parent group', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const inner = groupShapes(editor, ['a', 'b'])!;
    const outer = groupShapes(editor, [inner, 'c'])!;
    // Removing 'c' leaves outer with one child (inner); removing 'b' leaves
    // inner with one child. Both groups are then redundant.
    editor.deleteShapes(['b', 'c']);
    const dissolved = pruneDegenerateGroups(editor, [inner, outer]);
    expect(dissolved.sort()).toEqual([inner, outer].sort());
    expect(parentOf(editor, 'a')).toBeNull();
  });

  it('leaves healthy groups and non-group parents alone', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'a', parentId: 'frame' },
      { id: 'b' },
      { id: 'c' },
    ]);
    const gid = groupShapes(editor, ['b', 'c'])!;
    expect(pruneDegenerateGroups(editor, [gid, 'frame'])).toEqual([]);
    expect(editor.getShape(gid)).toBeDefined();
    expect(editor.getShape('frame')).toBeDefined();
  });
});

describe('deleteShapesWithCleanup', () => {
  it('prunes the group a deleted child leaves behind', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const gid = groupShapes(editor, ['a', 'b'])!;
    deleteShapesWithCleanup(editor, ['b']);
    // One-child group dissolves; 'a' survives on the page.
    expect(editor.getShape(gid)).toBeUndefined();
    expect(parentOf(editor, 'a')).toBeNull();
    expect(editor.getShape('c')).toBeDefined();
  });

  it('leaves the group when enough children remain', () => {
    const editor = makeEditor([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    const gid = groupShapes(editor, ['a', 'b', 'c'])!;
    deleteShapesWithCleanup(editor, ['c']);
    expect(editor.getShape(gid)).toBeDefined();
    expect(parentOf(editor, 'a')).toBe(gid);
  });
});

describe('duplicateShapes', () => {
  /** An arrow bound to `targetId`, plus the plain shape it points at. */
  function boundArrow(targetId: string): Editor {
    const editor = makeEditor([
      { id: targetId },
      { id: 'arrow', type: 'arrow' },
    ]);
    const arrow = editor.getShape('arrow')!;
    (arrow.props as Record<string, unknown>).bindings = {
      start: { shapeId: targetId, anchor: { x: 0.5, y: 0.5 } },
      end: null,
    };
    return editor;
  }

  const bindingTarget = (editor: Editor, id: string): string | undefined =>
    (
      editor.getShape(id)?.props as {
        bindings?: { start?: { shapeId: string } | null };
      }
    ).bindings?.start?.shapeId;

  it('binds the cloned arrow to the cloned target, not the original', () => {
    const editor = boundArrow('rect');
    const [newRect, newArrow] = duplicateShapes(editor, ['rect', 'arrow']);

    expect(newArrow).toBeDefined();
    expect(bindingTarget(editor, newArrow!)).toBe(newRect);
    // The original is untouched.
    expect(bindingTarget(editor, 'arrow')).toBe('rect');
  });

  it('leaves a binding to a shape outside the duplicated set alone', () => {
    const editor = boundArrow('rect');
    const [newArrow] = duplicateShapes(editor, ['arrow']);

    expect(bindingTarget(editor, newArrow!)).toBe('rect');
  });
});
