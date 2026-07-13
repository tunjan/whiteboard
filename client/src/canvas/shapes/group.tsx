import type { ShapeUtil } from './types';

/**
 * A group is a pure selection container. It has no geometry of its own (its
 * bounds are derived from its children by the selection layer) and renders
 * nothing — its children render normally in the flat z-order.
 */
export const groupUtil: ShapeUtil<'group'> = {
  type: 'group',
  canResize: false,
  canSnap: false,

  getDefaultProps: () => ({}),

  // Degenerate bounds; the real selection box is computed from descendants.
  getBounds: (s) => ({ minX: s.x, minY: s.y, maxX: s.x, maxY: s.y }),

  // Never hit directly — clicks land on children, which resolve to the group.
  hitTest: () => false,

  resize: (initial) => ({ x: initial.x, y: initial.y, props: initial.props }),

  Component: () => null,
};
