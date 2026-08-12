// Dirty-set expansion across binding edges.
//
// When a shape moves, the shapes whose geometry *derives* from it are dirty too
// and must be re-resolved. In this document model that is exactly one relation:
// a connector (arrow) whose endpoint is bound to a target shape.
//
// The other two expansion directions do not apply here, by construction:
//
//   - Ancestors. Groups carry no geometry and are deliberately excluded from
//     the spatial index; a frame owns an explicit w/h rather than deriving its
//     bounds from its children. So a child moving never changes a parent's
//     bounds.
//   - Descendants. Children store world coordinates, and `moveTargetIds`
//     already expands a frame/group drag into an explicit mutation per
//     descendant, each of which reindexes itself.
//
// Adding walks for those two would be dead code, so this graph tracks bindings
// only. Arrows are not themselves bindable (`isBindableShape` rejects them), so
// the relation is bipartite and expansion is single-hop — no transitive walk,
// no cycle guard.

import type { Shape } from '@whiteboard/shared';

/** The target ids an arrow's two endpoints are currently bound to. */
function bindingTargetsOf(shape: Shape): string[] {
  if (shape.type !== 'arrow') return [];
  const bindings = shape.props.bindings;
  if (!bindings) return [];
  const out: string[] = [];
  const start = bindings.start?.shapeId;
  const end = bindings.end?.shapeId;
  if (start) out.push(start);
  if (end && end !== start) out.push(end);
  return out;
}

/**
 * Incrementally maintained `target -> arrows` index, kept in sync alongside the
 * spatial index as shapes change.
 */
export class BindingGraph {
  private arrowsByTarget = new Map<string, Set<string>>();
  private targetsByArrow = new Map<string, string[]>();

  /**
   * (Re)index one shape. Safe to call for every changed shape: non-arrows and
   * unbound arrows are cheap no-ops.
   */
  update(shape: Shape): void {
    const targets = bindingTargetsOf(shape);
    const previous = this.targetsByArrow.get(shape.id);

    if (targets.length === 0) {
      if (previous) this.remove(shape.id);
      return;
    }
    if (previous && sameTargets(previous, targets)) return;

    if (previous) this.detach(shape.id, previous);
    for (const target of targets) {
      let set = this.arrowsByTarget.get(target);
      if (!set) {
        set = new Set();
        this.arrowsByTarget.set(target, set);
      }
      set.add(shape.id);
    }
    this.targetsByArrow.set(shape.id, targets);
  }

  /** Drop an arrow (or any shape) from the graph. */
  remove(id: string): void {
    const targets = this.targetsByArrow.get(id);
    if (!targets) return;
    this.detach(id, targets);
    this.targetsByArrow.delete(id);
  }

  clear(): void {
    this.arrowsByTarget.clear();
    this.targetsByArrow.clear();
  }

  /** Ids of arrows with an endpoint bound to `targetId`. */
  arrowsBoundTo(targetId: string): string[] {
    const set = this.arrowsByTarget.get(targetId);
    return set ? [...set] : [];
  }

  /** True when any arrow is bound to anything. */
  get isEmpty(): boolean {
    return this.targetsByArrow.size === 0;
  }

  /**
   * The dirty set: `changedIds` plus every arrow bound to one of them. Arrows
   * that changed directly are already included by virtue of being in
   * `changedIds`.
   */
  expand(changedIds: Iterable<string>): Set<string> {
    const dirty = new Set<string>();
    for (const id of changedIds) {
      dirty.add(id);
      const bound = this.arrowsByTarget.get(id);
      if (bound) for (const arrowId of bound) dirty.add(arrowId);
    }
    return dirty;
  }

  private detach(arrowId: string, targets: readonly string[]): void {
    for (const target of targets) {
      const set = this.arrowsByTarget.get(target);
      if (!set) continue;
      set.delete(arrowId);
      if (set.size === 0) this.arrowsByTarget.delete(target);
    }
  }
}

function sameTargets(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}
