import { type Bounds, type Shape, isContainerType } from '@whiteboard/shared';
import { shapeRotatedBounds } from './shape-bounds';

/** Direct children of `parentId`. */
export function childrenOf(shapes: Shape[], parentId: string): Shape[] {
  return shapes.filter((s) => s.parentId === parentId);
}

/** All descendants of `id` (children, grandchildren, …), excluding `id`. */
export function descendantsOf(shapes: Shape[], id: string): Shape[] {
  const byParent = new Map<string, Shape[]>();
  for (const s of shapes) {
    if (s.parentId) {
      const list = byParent.get(s.parentId) ?? [];
      list.push(s);
      byParent.set(s.parentId, list);
    }
  }
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
  for (const id of ids) {
    const s = byId.get(id);
    if (!s) continue;
    if (s.type === 'group') {
      for (const d of leafDescendants(shapes, id)) out.add(d.id);
      // Also move nested frames so their chrome follows.
      for (const d of descendantsOf(shapes, id)) {
        if (d.type === 'frame') out.add(d.id);
      }
    } else if (s.type === 'frame') {
      out.add(id);
      for (const d of descendantsOf(shapes, id)) out.add(d.id);
    } else {
      out.add(id);
    }
  }
  return [...out];
}

/** Expand selected ids into everything that should be deleted (with children). */
export function deleteTargetIds(shapes: Shape[], ids: string[]): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    out.add(id);
    for (const d of descendantsOf(shapes, id)) out.add(d.id);
  }
  return [...out];
}
