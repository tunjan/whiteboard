import type { Shape } from '@whiteboard/shared';

export function compareShapeOrder(a: Shape, b: Shape): number {
  return a.index < b.index
    ? -1
    : a.index > b.index
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

/** Sorted sibling buckets keyed by resolved parent; null is the page root.
 * Exposed so a caller that also needs the child lists builds them once. */
export function groupByParent(
  shapes: ReadonlyMap<string, Shape>,
): Map<string | null, Shape[]> {
  const children = new Map<string | null, Shape[]>();
  for (const shape of shapes.values()) {
    const parent =
      shape.parentId && shapes.has(shape.parentId) ? shape.parentId : null;
    const bucket = children.get(parent) ?? [];
    bucket.push(shape);
    children.set(parent, bucket);
  }
  for (const bucket of children.values()) bucket.sort(compareShapeOrder);
  return children;
}

/** Logical pre-order over buckets from {@link groupByParent}. */
export function paintOrderOf(
  shapes: ReadonlyMap<string, Shape>,
  children: ReadonlyMap<string | null, Shape[]>,
): Shape[] {
  const output: Shape[] = [],
    seen = new Set<string>();
  const visit = (roots: Shape[]) => {
    const stack = [...roots].reverse();
    while (stack.length) {
      const shape = stack.pop()!;
      if (seen.has(shape.id)) continue;
      seen.add(shape.id);
      output.push(shape);
      const descendants = children.get(shape.id) ?? [];
      for (let i = descendants.length - 1; i >= 0; i--)
        stack.push(descendants[i]!);
    }
  };
  visit(children.get(null) ?? []);
  // Deterministic recovery for malformed/concurrently cyclic parent records.
  if (seen.size < shapes.size)
    visit([...shapes.values()].sort(compareShapeOrder));
  return output;
}

/** Logical pre-order defines painting and picking; DOM order remains id order. */
export function paintOrder(shapes: ReadonlyMap<string, Shape>): Shape[] {
  return paintOrderOf(shapes, groupByParent(shapes));
}
