import { genId, type Shape } from '@whiteboard/shared';
import type { Editor } from './editor';
import { childrenOf, descendantsOf } from './hierarchy';
import { getTopIndex } from './order';

const DUPLICATE_OFFSET = 16;

function byIndex(a: Shape, b: Shape): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : 0;
}

/**
 * Materialize clones of `subtree` into the editor with fresh ids, remapping
 * `parentId` within the subtree so container relationships survive. Each clone
 * is offset and stacked on top. Returns the new ids of the original roots.
 */
export function materializeClones(
  editor: Editor,
  subtree: Shape[],
  rootIds: string[],
  offset: { x: number; y: number },
  keepExternalParent: boolean,
): string[] {
  const idMap = new Map<string, string>();
  for (const s of subtree) idMap.set(s.id, genId());
  const newRoots: string[] = [];
  for (const s of [...subtree].sort(byIndex)) {
    const newId = idMap.get(s.id)!;
    const remapped = s.parentId ? idMap.get(s.parentId) : undefined;
    const parentId = remapped ?? (keepExternalParent ? (s.parentId ?? null) : null);
    const clone = {
      ...s,
      id: newId,
      parentId,
      x: s.x + offset.x,
      y: s.y + offset.y,
      index: getTopIndex(editor.getShapes()),
      props: structuredClone(s.props),
      locked: false,
    } as Shape;
    editor.createShape(clone);
    if (rootIds.includes(s.id)) newRoots.push(newId);
  }
  return newRoots;
}

/** The shapes in `ids` plus all their descendants (the full subtree). */
export function collectSubtree(editor: Editor, ids: string[]): Shape[] {
  const all = editor.getShapes();
  const set = new Set<string>();
  for (const id of ids) {
    set.add(id);
    for (const d of descendantsOf(all, id)) set.add(d.id);
  }
  return all.filter((s) => set.has(s.id));
}

/** Clone shapes (and their children), offset and stacked on top. */
export function duplicateShapes(editor: Editor, ids: string[]): string[] {
  const subtree = collectSubtree(editor, ids);
  return materializeClones(
    editor,
    subtree,
    ids,
    { x: DUPLICATE_OFFSET, y: DUPLICATE_OFFSET },
    true,
  );
}

/**
 * Wrap the given selection units in a new group (needs 2+). Each becomes a child
 * of the group; returns the new group id.
 */
export function groupShapes(editor: Editor, ids: string[]): string | null {
  if (ids.length < 2) return null;
  const groupId = genId();
  const group = {
    id: groupId,
    type: 'group',
    x: 0,
    y: 0,
    rotation: 0,
    index: getTopIndex(editor.getShapes()),
    props: {},
  } as Shape;
  editor.createShape(group);
  for (const id of ids) editor.updateShape(id, { parentId: groupId });
  return groupId;
}

/**
 * Dissolve any selected groups: their children are reparented up one level and
 * the group shapes deleted. Returns the freed children ids.
 */
export function ungroupShapes(editor: Editor, ids: string[]): string[] {
  const shapes = editor.getShapes();
  const freed: string[] = [];
  const toDelete: string[] = [];
  for (const id of ids) {
    const group = editor.getShape(id);
    if (group?.type !== 'group') continue;
    for (const child of childrenOf(shapes, id)) {
      editor.updateShape(child.id, { parentId: group.parentId ?? null });
      freed.push(child.id);
    }
    toDelete.push(id);
  }
  if (toDelete.length) editor.deleteShapes(toDelete);
  return freed;
}
