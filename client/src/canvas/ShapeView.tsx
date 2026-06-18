import { memo } from 'react';
import type { Shape } from '@whiteboard/shared';
import { shapeRegistry } from './shapes/shape-registry';

/**
 * Renders a single shape via its registered util. Memoized on the shape
 * reference and its resolved `opacity`, so committed shapes don't re-render when
 * other shapes change — the main defense against SVG churn during long sessions.
 *
 * `opacity` is the fully resolved render opacity (ancestor compounding plus any
 * eraser dim), computed by the canvas; values below 1 wrap the shape in an
 * opacity group so the browser composites it against the layers beneath.
 */
export const ShapeView = memo(function ShapeView({
  shape,
  opacity = 1,
}: {
  shape: Shape;
  opacity?: number;
}) {
  const util = shapeRegistry.getFor(shape);
  if (!util) return null;
  const Component = util.Component;
  if (opacity >= 1) return <Component shape={shape} />;
  return (
    <g opacity={opacity}>
      <Component shape={shape} />
    </g>
  );
});
