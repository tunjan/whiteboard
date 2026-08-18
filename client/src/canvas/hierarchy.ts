import { type Bounds, type Shape, isContainerType } from '@whiteboard/shared';
import { shapeRotatedBounds } from './shape-bounds';

/** Direct children of `parentId`. */
export function childrenOf(shapes: Shape[], parentId: string): Shape[] {
  return shapes.filter((s) => s.parentId === parentId);
}

/**
 * `parentId -> children`, the index every downward walk needs. Callers that
 * walk more than one subtree build it once and reuse it: it costs a pass over
 * the whole page, so rebuilding it per id made expanding a selection O(N·k).
 */
type ChildIndex = Map<string, Shape[]>;

function childIndex(shapes: Shape[]): ChildIndex {
  const byParent: ChildIndex = new Map();
  for (const s of shapes) {
    if (!s.parentId) continue;
    const list = byParent.get(s.parentId);
    if (list) list.push(s);
    else byParent.set(s.parentId, [s]);
  }
  return byParent;
}

function descendantsIn(byParent: ChildIndex, id: string): Shape[] {
  const out: Shape[] = [];
  const stack = [...(byParent.get(id) ?? [])];
  while (stack.length) {
    const s = stack.pop()!;
    out.push(s);
    const kids = byParent.get(s.id);
    if (kids) stack.push(...kids);
  }
  return out;
}

/** All descendants of `id` (children, grandchildren, …), excluding `id`. */
export function descendantsOf(shapes: Shape[], id: string): Shape[] {
  return descendantsIn(childIndex(shapes), id);
}

/** Non-container descendants (the leaves that carry real geometry). */
export function leafDescendants(shapes: Shape[], id: string): Shape[] {
  return descendantsOf(shapes, id).filter((s) => !isContainerType(s.type));
}

/**
 * The id to actually select when `id` is clicked: walk up to the outermost
 * group ancestor, stopping at `enteredGroupId` (so once you've entered a group
 * you can select its members directly). Frames are pass-through (not selection
 * units). Returns `id` itself when it has no group ancestor.
 */
export function selectionTargetId(
  getShape: (id: string) => Shape | undefined,
  id: string,
  enteredGroupId: string | null,
): string {
  let target = id;
  let cur = getShape(id);
  const guard = new Set<string>();
  while (cur?.parentId && !guard.has(cur.id)) {
    guard.add(cur.id);
    const parent = getShape(cur.parentId);
    if (!parent) break;
    if (parent.type === 'group') {
      if (parent.id === enteredGroupId) break;
      target = parent.id;
    }
    cur = parent;
  }
  return target;
}

/** Ancestor ids of `id`, outermost first, excluding `id` itself. */
function ancestorChain(
  getShape: (id: string) => Shape | undefined,
  id: string,
): string[] {
  const chain: string[] = [];
  const guard = new Set<string>([id]);
  let cur = getShape(id);
  while (cur?.parentId && !guard.has(cur.parentId)) {
    guard.add(cur.parentId);
    const parent = getShape(cur.parentId);
    if (!parent) break;
    chain.unshift(parent.id);
    cur = parent;
  }
  return chain;
}

/**
 * The innermost container that contains every one of `ids`, or null when they
 * share only the page. A new group is created there, so grouping two shapes
 * that live inside a frame keeps the group — and therefore them — in the frame.
 */
export function findCommonAncestor(
  getShape: (id: string) => Shape | undefined,
  ids: readonly string[],
): string | null {
  if (ids.length === 0) return null;
  let common = ancestorChain(getShape, ids[0]!);
  for (let i = 1; i < ids.length && common.length > 0; i++) {
    const chain = ancestorChain(getShape, ids[i]!);
    let n = 0;
    while (n < common.length && n < chain.length && common[n] === chain[n]) n++;
    common = common.slice(0, n);
  }
  return common.length ? common[common.length - 1]! : null;
}

/**
 * Innermost group/frame shared by all shapes. Unlike `findCommonAncestor`, a
 * target that is itself a container participates in the chain; this is what an
 * arrow bound to a frame and one of its descendants needs.
 */
export function findClosestCommonContainer(
  getShape: (id: string) => Shape | undefined,
  ids: readonly string[],
): string | null {
  if (!ids.length) return null;
  const chainFor = (id: string): string[] => {
    const shape = getShape(id);
    const chain = ancestorChain(getShape, id).filter((ancestorId) => {
      const ancestor = getShape(ancestorId);
      return ancestor ? isContainerType(ancestor.type) : false;
    });
    if (shape && isContainerType(shape.type)) chain.push(shape.id);
    return chain;
  };
  let common = chainFor(ids[0]!);
  for (let index = 1; index < ids.length && common.length; index++) {
    const chain = chainFor(ids[index]!);
    let shared = 0;
    while (
      shared < common.length &&
      shared < chain.length &&
      common[shared] === chain[shared]
    ) {
      shared++;
    }
    common = common.slice(0, shared);
  }
  return common.length ? common[common.length - 1]! : null;
}

/** Union of the rotated world bounds of `id`'s leaf descendants, or null. */
export function containerBounds(shapes: Shape[], id: string): Bounds | null {
  const leaves = leafDescendants(shapes, id);
  if (leaves.length === 0) return null;
  let acc: Bounds | null = null;
  for (const leaf of leaves) {
    const b = shapeRotatedBounds(leaf);
    acc = acc
      ? {
          minX: Math.min(acc.minX, b.minX),
          minY: Math.min(acc.minY, b.minY),
          maxX: Math.max(acc.maxX, b.maxX),
          maxY: Math.max(acc.maxY, b.maxY),
        }
      : b;
  }
  return acc;
}

/**
 * Expand selected ids into the actual shapes to move/transform: containers are
 * replaced by their descendants (frames keep themselves so the chrome moves
 * too; groups are dropped since they have no geometry).
 */
export function moveTargetIds(shapes: Shape[], ids: string[]): string[] {
  const out = new Set<string>();
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const byParent = childIndex(shapes);
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.type === 'group') {
      // Leaves carry the geometry; nested frames come too so their chrome follows.
      for (const d of descendantsIn(byParent, id)) {
        if (!isContainerType(d.type) || d.type === 'frame') out.add(d.id);
      }
    } else if (s.type === 'frame') {
      out.add(id);
      for (const d of descendantsIn(byParent, id)) out.add(d.id);
    } else {
      out.add(id);
    }
  }
  return [...out];
}

/** Expand selected ids into everything that should be deleted (with children). */
export function deleteTargetIds(shapes: Shape[], ids: string[]): string[] {
  const out = new Set<string>();
  const byParent = childIndex(shapes);
  for (const id of ids) {
    out.add(id);
    for (const d of descendantsIn(byParent, id)) out.add(d.id);
  }
  return [...out];
}
