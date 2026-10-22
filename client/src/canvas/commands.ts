import { genId, type Shape } from '@whiteboard/shared';
import type { Editor } from './editor';
import { childrenOf, descendantsOf, findCommonAncestor } from './hierarchy';
import { getIndexAboveTopmostOf, getTopIndex, jitterKeyBetween } from './order';

const DUPLICATE_OFFSET = 16;

function byIndex(a: Shape, b: Shape): number {
  return a.index < b.index ? -1 : a.index > b.index ? 1 : 0;
}

/**
 * Rewrite a connector's bindings onto cloned targets. A terminal bound to a
 * shape that was cloned follows the clone. One bound outside the cloned set
 * keeps pointing at the original when `keepExternal` (same-page duplication);
 * otherwise it is dropped, or a paste at the cursor would snap straight back
 * onto the original target.
 */
function remapBindings(
  props: Record<string, unknown>,
  idMap: Map<string, string>,
  keepExternal: boolean,
): void {
  const bindings = props.bindings as
    | { start?: { shapeId: string } | null; end?: { shapeId: string } | null }
    | undefined;
  if (!bindings) return;
  for (const terminal of ['start', 'end'] as const) {
    const binding = bindings[terminal];
    const mapped = binding ? idMap.get(binding.shapeId) : undefined;
    if (binding && mapped) binding.shapeId = mapped;
    else if (binding && !keepExternal) bindings[terminal] = null;
  }
}

/**
 * Materialize clones of `subtree` into the editor with fresh ids, remapping
 * `parentId` within the subtree so container relationships survive. Each clone
 * is offset and stacked on top. Returns the new ids of the original roots.
 * `keepExternalParent` also keeps arrow bindings to shapes outside `subtree`.
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
  const roots = new Set(rootIds);
  const newRoots: string[] = [];
  // One transaction, so `getShapes()` goes stale after the first create: take
  // the top once and stack each clone above the previous one.
  let index = getTopIndex(editor.getShapes());
  editor.transact(() => {
    for (const s of [...subtree].sort(byIndex)) {
      const newId = idMap.get(s.id)!;
      const remapped = s.parentId ? idMap.get(s.parentId) : undefined;
      const parentId =
        remapped ?? (keepExternalParent ? (s.parentId ?? null) : null);
      const clone = {
        ...s,
        id: newId,
        parentId,
        x: s.x + offset.x,
        y: s.y + offset.y,
        index,
        props: structuredClone(s.props),
        locked: false,
      } as Shape;
      remapBindings(
        clone.props as Record<string, unknown>,
        idMap,
        keepExternalParent,
      );
      editor.createShape(clone);
      if (roots.has(s.id)) newRoots.push(newId);
      index = jitterKeyBetween(index, null);
    }
  });
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
 *
 * The group is created in the members' innermost common container, so grouping
 * shapes that live inside a frame leaves them inside that frame. It takes the
 * z-slot of its topmost member rather than the top of the page, so grouping
 * never changes what is drawn over what.
 *
 * The group's own `x`/`y` stay at the origin: children carry world coordinates
 * here, so a group has no geometry of its own (`groupUtil`) and its box is
 * derived from its descendants. Seeding it with the current bounds would just
 * go stale the moment a child moves.
 */
export function groupShapes(editor: Editor, ids: string[]): string | null {
  // Grouping reparents every member, which is an edit a lock forbids; the
  // unlocked rest still group.
  ids = ids.filter((id) => !editor.getShape(id)?.locked);
  if (ids.length < 2) return null;
  const groupId = genId();
  const group = {
    id: groupId,
    type: 'group',
    parentId: findCommonAncestor(editor.getShape, ids),
    x: 0,
    y: 0,
    rotation: 0,
    index: getIndexAboveTopmostOf(editor.getShapes(), ids),
    props: {},
  } as Shape;
  // One transaction: one undo step, one snapshot rebuild, and peers never
  // observe the half-built group (which would trip the invariants below).
  editor.transact(() => {
    editor.createShape(group);
    for (const id of ids) editor.updateShape(id, { parentId: groupId });
  });
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
  editor.transact(() => {
    for (const id of ids) {
      const group = editor.getShape(id);
      if (group?.type !== 'group' || group.locked) continue;
      for (const child of childrenOf(shapes, id)) {
        editor.updateShape(child.id, { parentId: group.parentId ?? null });
        freed.push(child.id);
      }
      toDelete.push(id);
    }
    if (toDelete.length) editor.deleteShapes(toDelete);
  });
  return freed;
}

/**
 * Re-establish the group invariants for `groupIds` after children were deleted
 * or reparented away: a group with no children deletes itself, and a group with
 * exactly one child dissolves (the child is promoted to the group's own parent,
 * keeping its world position — children carry world coordinates, so nothing has
 * to be re-projected). Dissolving can in turn empty the parent group, so this
 * walks upward until it settles. Non-group ids (frames) are ignored.
 *
 * Deliberately called explicitly rather than reacting to every child change:
 * `groupShapes` passes through a one-child state while it reparents, and a
 * reactive invariant would dissolve the group out from under it.
 *
 * `goneIds` names shapes the caller has already deleted. Inside an open
 * transaction `getShapes()` is served from a cache that has not seen those
 * deletes yet, so a group would still look full and keep itself alive; passing
 * them in is what makes this correct from inside a transaction.
 *
 * Returns the dissolved group ids. A stale `enteredGroupId` needs no cleanup —
 * `selectionTargetId` matches it by identity, so an id that no longer exists
 * simply stops matching, which is the same as not being in a group.
 */
export function pruneDegenerateGroups(
  editor: Editor,
  groupIds: Iterable<string>,
  goneIds: Iterable<string> = [],
): string[] {
  const shapes = editor.getShapes();
  const byId = new Map(shapes.map((s) => [s.id, s]));
  // The hierarchy is walked in memory rather than re-read per step: inside a
  // transaction `getShapes()` is served from a cache that does not yet see this
  // function's own writes.
  const childIds = new Map<string, string[]>();
  const parentOf = new Map<string, string | null>();
  for (const s of shapes) {
    parentOf.set(s.id, s.parentId ?? null);
    if (!s.parentId) continue;
    const list = childIds.get(s.parentId);
    if (list) list.push(s.id);
    else childIds.set(s.parentId, [s.id]);
  }

  // Seeded with what the caller already deleted, so those shapes neither keep a
  // group alive nor get reparented; `dissolved` is what this pass removed and
  // therefore what it has to write and report.
  const removed = new Set<string>(goneIds);
  const dissolved: string[] = [];
  const reparented: { id: string; parentId: string | null }[] = [];
  // Terminates: a parent is only enqueued after a group is removed, and a
  // removed group is skipped on re-visit.
  const queue = [...groupIds];
  while (queue.length) {
    const id = queue.pop()!;
    const group = byId.get(id);
    if (!group || group.type !== 'group' || removed.has(id)) continue;
    const children = (childIds.get(id) ?? []).filter((c) => !removed.has(c));
    if (children.length > 1) continue;

    const up = parentOf.get(id) ?? null;
    for (const childId of children) {
      reparented.push({ id: childId, parentId: up });
      parentOf.set(childId, up);
      if (up) childIds.set(up, [...(childIds.get(up) ?? []), childId]);
    }
    removed.add(id);
    dissolved.push(id);
    childIds.delete(id);
    if (up) queue.push(up);
  }

  if (!dissolved.length) return [];
  editor.transact(() => {
    for (const r of reparented)
      editor.updateShape(r.id, { parentId: r.parentId });
    editor.deleteShapes(dissolved);
  });
  return dissolved;
}

/**
 * Delete `ids` and prune whatever groups they leave degenerate. Use this for
 * user-facing deletes (selection, cut, eraser); a tool discarding a shape it
 * just created can keep calling `editor.deleteShapes` — a fresh shape has no
 * group parent to orphan.
 */
export function deleteShapesWithCleanup(editor: Editor, ids: string[]): void {
  const parents = new Set<string>();
  for (const id of ids) {
    const parentId = editor.getShape(id)?.parentId;
    if (parentId) parents.add(parentId);
  }
  editor.deleteShapes(ids);
  if (parents.size) pruneDegenerateGroups(editor, parents, ids);
}
