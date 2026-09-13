import { useCallback, useEffect, useRef } from 'react';
import { noteActivity } from '@/collab/attention';
import { setLocalCursor } from '@/collab/presence';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { cn } from '@/lib/utils';
import { boundsCenter, boundsContainsPoint, type Point } from './geometry';
import { boundsSize } from './minimap-geometry';
import { MinimapManager } from './minimap-manager';
import { useCameraStore } from './use-camera-store';
import { useDocumentStore } from './use-document-store';

/**
 * Squared screen distance a press may wander before it counts as a drag.
 *
 * A press outside the viewport rectangle starts an animated jump, and reading
 * the first stray pixel of hand tremor as a drag would cancel that animation on
 * the frame it began.
 */
const CLICK_JITTER_THRESHOLD_SQ = 4;

function dist2(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Spatial overview of the page and a handle on the viewport.
 *
 * Pressing inside the viewport rectangle drags it, keeping whatever part of it
 * you grabbed under the pointer. Pressing outside recentres the board there,
 * animated. Shift holds the drag to one axis, and a double-click jumps without
 * the boundary clamp.
 *
 * Rendered inside the canvas container rather than beside it, so the board's
 * own wheel handler already receives scroll and pinch over the minimap — the
 * separate re-dispatch a sibling would need is `usePassThroughWheelEvents`,
 * which the floating UI layer already applies to the panels that are siblings.
 */
export function Minimap() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const managerRef = useRef<MinimapManager | null>(null);
  const pointing = useRef(false);
  const activePointerId = useRef<number | null>(null);
  const originScreenPoint = useRef<Point>({ x: 0, y: 0 });

  useEffect(() => {
    const elem = canvasRef.current;
    if (!elem) return;
    const manager = new MinimapManager(elem);
    managerRef.current = manager;
    return () => {
      manager.close();
      managerRef.current = null;
    };
  }, []);

  const onDoubleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const manager = managerRef.current;
    if (!manager) return;
    if (!useDocumentStore.getState().shapes.length) return;

    const { clientX: x, clientY: y } = e;
    // Seed the drag anchors even though nothing is being dragged: a shift-drag
    // begun straight after the jump snaps against this origin.
    manager.originPagePoint = manager.minimapScreenPointToPagePoint(
      x,
      y,
      false,
      true,
    );
    manager.originPageCenter = boundsCenter(manager.getViewportPageBounds.get());

    stopFollowingForManualCameraChange();
    useCameraStore
      .getState()
      .animateCenterOn(manager.minimapScreenPointToPagePoint(x, y));
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const manager = managerRef.current;
      if (!manager || e.button !== 0) return;

      const elem = e.currentTarget;
      elem.setPointerCapture(e.pointerId);
      if (!useDocumentStore.getState().shapes.length) return;

      noteActivity();
      const { clientX: x, clientY: y } = e;
      pointing.current = true;
      activePointerId.current = e.pointerId;
      originScreenPoint.current = { x, y };
      manager.grabbedViewport = false;

      const point = manager.minimapScreenPointToPagePoint(x, y);
      const vp = manager.getViewportPageBounds.get();

      if (
        boundsContainsPoint(manager.getAllowedJumpBounds(), point) &&
        !boundsContainsPoint(vp, point)
      ) {
        // Outside the viewport: recentre on the press, and anchor a subsequent
        // drag as though the viewport had already arrived there.
        const size = boundsSize(vp);
        manager.originPagePoint = {
          x: point.x + size.width / 2,
          y: point.y + size.height / 2,
        };
        manager.originPageCenter = point;
        stopFollowingForManualCameraChange();
        useCameraStore.getState().animateCenterOn(point);
        return;
      }

      const clamped = manager.minimapScreenPointToPagePoint(x, y, false, true);
      manager.grabbedViewport = boundsContainsPoint(vp, clamped);
      manager.originPagePoint = clamped;
      manager.originPageCenter = boundsCenter(vp);
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const manager = managerRef.current;
      if (!manager) return;

      const { clientX: x, clientY: y } = e;
      const point = manager.minimapScreenPointToPagePoint(
        x,
        y,
        e.shiftKey,
        true,
      );

      if (pointing.current) {
        if (
          dist2(originScreenPoint.current, { x, y }) <=
          CLICK_JITTER_THRESHOLD_SQ
        ) {
          return;
        }
        stopFollowingForManualCameraChange();
        const camera = useCameraStore.getState();
        if (manager.grabbedViewport) {
          // Keep the grabbed spot inside the rectangle under the pointer
          // instead of snapping its centre to the cursor.
          const grab = {
            x: manager.originPagePoint.x - manager.originPageCenter.x,
            y: manager.originPagePoint.y - manager.originPageCenter.y,
          };
          camera.centerOn({ x: point.x - grab.x, y: point.y - grab.y });
        } else {
          camera.centerOn(point);
        }
      }

      // Peers watch the local cursor, and while it is over the minimap the
      // place it is pointing at is a world point somewhere else entirely.
      setLocalCursor(manager.minimapScreenPointToPagePoint(x, y));
    },
    [],
  );

  const endDrag = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const id = activePointerId.current;
    if (id !== null && e.currentTarget.hasPointerCapture(id)) {
      e.currentTarget.releasePointerCapture(id);
    }
    pointing.current = false;
    activePointerId.current = null;
  }, []);

  return (
    <div
      data-ui-layer
      className={cn(
        'absolute left-[max(0.5rem,env(safe-area-inset-left))] z-[var(--z-canvas-hud)] select-none',
        // Directly above the history HUD, mirroring the ladder the video panel
        // climbs on the other side.
        'bottom-[calc(3.25rem+var(--wb-inset-bottom))]',
        'max-sm:bottom-[calc(7.25rem+var(--wb-inset-bottom))]',
        '[@media(pointer:coarse)]:bottom-[calc(11rem+var(--wb-inset-bottom))]',
      )}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Board overview"
        data-testid="minimap.canvas"
        className="block h-28 w-40 touch-none rounded-panel border border-border/70"
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />
    </div>
  );
}
