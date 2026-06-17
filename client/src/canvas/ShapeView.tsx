import { memo } from 'react';
import type { Shape } from '@whiteboard/shared';
import { shapeRegistry } from './shapes/shape-registry';

/**
 * Renders a single shape via its registered util. Memoized on the shape
 * reference, so committed shapes don't re-render when other shapes change —
 * the main defense against SVG churn during long sessions.
 */
export const ShapeView = memo(function ShapeView({ shape }: { shape: Shape }) {
  const util = shapeRegistry.getFor(shape);
  if (!util) return null;
  const Component = util.Component;
  return <Component shape={shape} />;
});
