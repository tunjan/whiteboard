import { memo } from 'react';
import type { Shape } from '@whiteboard/shared';
import { inkShape } from './ink-color';
import { shapeRegistry } from './shapes/shape-registry';

/**
 * Renders a single shape via its registered util. Memoized on the shape
 * reference and its resolved `opacity`, so committed shapes don't re-render when
 * other shapes change — the main defense against SVG churn during long sessions.
 *
 * `opacity` is the fully resolved render opacity (ancestor compounding plus any
 * eraser dim), computed by the canvas; values below 1 wrap the shape in an
 * opacity group so the browser composites it against the layers beneath.
 *
 * Ink is recolored for the viewer's theme on the way in (`inkShape`). It's done
 * here rather than in each util so there is one place that decides it, and it
 * costs no subscription: the swap is to a CSS custom property, so the memo
 * above still holds across a theme flip and the browser repaints on its own.
 */
export const ShapeView = memo(function ShapeView({
  shape,
  opacity = 1,
  inkPass,
}: {
  shape: Shape;
  opacity?: number;
  inkPass?: 'underlay' | 'overlay';
}) {
  const util = shapeRegistry.getFor(shape);
  if (!util) return null;
  const Component = util.Component;
  const painted = inkShape(shape);
  if (opacity >= 1) return <Component shape={painted} inkPass={inkPass} />;
  return (
    <g opacity={opacity}>
      <Component shape={painted} inkPass={inkPass} />
    </g>
  );
});
