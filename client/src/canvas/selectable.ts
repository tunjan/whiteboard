import type { Shape } from '@whiteboard/shared';
import { useHiddenStore } from './use-hidden-store';

/** Hidden shapes are invisible and never participate in hit-testing. */
export function isVisible(shape: Shape): boolean {
  return !useHiddenStore.getState().isHidden(shape.id);
}

/** Selectable = visible and not locked (locked shapes are protected). */
export function isSelectable(shape: Shape): boolean {
  return !shape.locked && isVisible(shape);
}
