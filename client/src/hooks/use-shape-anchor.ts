import { useLayoutEffect, type RefObject } from 'react';
import { worldToScreen } from '@/canvas/camera';
import { shapeRotatedBounds } from '@/canvas/shape-bounds';
import { useCameraStore } from '@/canvas/use-camera-store';
import { react } from '@tldraw/state';
import { shapeStore } from '@/canvas/engine/shape-store';

/** Screen-px gap between the shape's edge and the panel docked to it. */
const GAP = 12;
/** Smallest gap the panel keeps from the viewport edges. */
const MARGIN = 12;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * Lowest y in `layer` a panel may reach: the top of the canvas toolbar when it
 * is docked along the bottom, else the layer's own bottom edge. The toolbar
 * floats in the same layer, so without this a tall panel runs underneath it.
 */
function bottomEdge(layer: HTMLElement): number {
  const viewH = layer.clientHeight;
  const toolbar = layer.querySelector<HTMLElement>(
    '[data-canvas-toolbar][data-placement="bottom"]',
  );
  if (!toolbar) return viewH;
  const top =
    toolbar.getBoundingClientRect().top - layer.getBoundingClientRect().top;
  return Math.min(viewH, top);
}

/**
 * Docks `ref` to a shape's on-screen box, so a panel reads as part of that
 * shape rather than as floating chrome.
 *
 * The panel keeps its screen size at every zoom — it holds math fields and
 * sliders, which stop being usable the moment they scale with the camera — so
 * only its position tracks the shape.
 *
 * Position is written straight to the element rather than through state: this
 * runs on every pan and zoom frame, and re-rendering the panel (MathLive
 * fields included) at that rate is the one thing the camera store's hot path
 * is careful to avoid. It writes the `translate` property, leaving `transform`
 * free for the open/close slide in `.t-panel-slide`.
 */
export function useShapeAnchor(
  ref: RefObject<HTMLElement | null>,
  shapeId: string | null,
): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !shapeId) return;

    let frame = 0;

    const place = () => {
      frame = 0;
      const shape = shapeStore.peek(shapeId);
      // `.wb-ui-layer`: the click-through plane the panel is positioned in,
      // which shares the canvas's origin, so world->screen px land in its
      // coordinate space unchanged.
      const layer = element.offsetParent as HTMLElement | null;
      if (!shape || !layer) return;

      const { camera } = useCameraStore.getState();
      const world = shapeRotatedBounds(shape);
      const topLeft = worldToScreen({ x: world.minX, y: world.minY }, camera);
      const bottomRight = worldToScreen(
        { x: world.maxX, y: world.maxY },
        camera,
      );

      const viewW = layer.clientWidth;
      const viewBottom = bottomEdge(layer);
      // Measured, not assumed: the panel grows with every curve and slider, and
      // both the flip and the clamp below depend on its real size.
      const panelW = element.offsetWidth;
      const panelH = element.offsetHeight;

      // Dock to the shape's left, flipping to its right when the left side has
      // no room and the right side does. Either way the result is clamped into
      // the viewport, so panning the graph off-screen slides the panel to the
      // edge instead of taking it along.
      const leftX = topLeft.x - GAP - panelW;
      const rightX = bottomRight.x + GAP;
      const side =
        leftX < MARGIN && rightX + panelW <= viewW - MARGIN ? 'right' : 'left';
      const x = clamp(
        side === 'left' ? leftX : rightX,
        MARGIN,
        Math.max(MARGIN, viewW - MARGIN - panelW),
      );
      const y = clamp(
        topLeft.y,
        MARGIN,
        Math.max(MARGIN, viewBottom - MARGIN - panelH),
      );

      element.dataset.anchorSide = side;
      element.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
      element.style.setProperty(
        '--anchor-max-h',
        `${Math.max(0, viewBottom - MARGIN * 2)}px`,
      );
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };

    place();

    const unsubscribeCamera = useCameraStore.subscribe(schedule);
    // Follows this one shape: an edit anywhere else leaves the panel alone.
    let first = true;
    const unsubscribeDocument = react('shape anchor', () => {
      shapeStore.record(shapeId).get();
      if (!first) schedule();
      first = false;
    });
    // Covers the panel's own growth and the viewport resizing under it.
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    resize.observe(element.offsetParent ?? element);

    return () => {
      cancelAnimationFrame(frame);
      unsubscribeCamera();
      unsubscribeDocument();
      resize.disconnect();
    };
  }, [ref, shapeId]);
}
