import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ComponentProps, MouseEvent as ReactMouseEvent } from 'react';
import { type Shape, pointInPolygon } from '@whiteboard/shared';
import './shapes/register';
import './tools/register';
import { ActiveStrokeLayer } from './ActiveStrokeLayer';
import { hitTestCanvas } from './engine/hit-test';
import { ShapeLayer } from './shape-renderer';
import { shapeStore } from './engine/shape-store';
import { useShape, useShapes, useStoreValue } from './use-shapes';
import { useBenchFlags } from './bench-flags';
import { Background } from './Background';
import { CanvasControls } from './CanvasControls';
import { Minimap } from './Minimap';
import { isActualSize, nextDiscreteZoom, screenToWorld } from './camera';
import { QuickZoomFrame } from './QuickZoomFrame';
import { useEdgeScroll } from './use-edge-scroll';
import { viewportWorldBounds } from './geometry';
import { PerformanceOverlay } from '@/components/performance-overlay';
import { CursorsLayer } from '@/collab/CursorsLayer';
import { PeerSelectionLayer } from '@/collab/PeerSelectionLayer';
import { CommentsLayer } from './CommentsLayer';
import { DrawingCursor } from './DrawingCursor';
import { EraserCursor } from './EraserCursor';
import { LaserCursor } from './LaserCursor';
import { EraserTrail } from './EraserTrail';
import { LaserLayer } from './LaserLayer';
import { MeasureLayer } from './MeasureLayer';
import {
  setLocalCursor,
  setLocalCursorType,
  setLocalFollowing,
  setLocalViewport,
} from '@/collab/presence';
import {
  stopFollowingForManualCameraChange,
  useFollowStore,
} from '@/collab/use-follow-store';
import { useShallow } from 'zustand/react/shallow';
import { usePresenceStore } from '@/collab/use-presence-store';
import { VanishLayer } from './VanishLayer';
import { HoverLayer } from './HoverLayer';
import { SelectionLayer } from './SelectionLayer';
import { SelectionToolbar } from './SelectionToolbar';
import { TextEditorOverlay } from './TextEditorOverlay';
import { FrameTitleEditorOverlay } from './FrameTitleEditorOverlay';
import { VideoPlayerOverlay } from './VideoPlayerOverlay';
import { ImageCropOverlay } from './ImageCropOverlay';
import { toolRegistry } from './tools/tool-registry';
import type { ToolContext } from './tools/types';
import { setContextMenuPoint } from './clipboard';
import {
  bindingGraph,
  editor,
  setCurrentPage,
  setCurrentPageForFollow,
  spatialIndex,
  takeBindingDirty,
  useDocumentStore,
} from './use-document-store';
import { syncBoundArrows } from './shapes/connector-routing';
import { useCameraStore } from './use-camera-store';
import { subscribeCanvasZoomToBounds } from './camera-requests';
import { useCameraInteraction } from './use-camera-interaction';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { getContainerRect, useContainerRect } from './container-rect';
import { useElementSize } from './use-element-size';
import { useSafariGestures } from './use-safari-gestures';
import { getSelectionInfo } from './selection-geometry';
import { shapeRotatedBounds } from './shape-bounds';
import { useHiddenStore } from './use-hidden-store';
import { clearHover } from './use-hover-store';
import { useLiveStrokeShapeId } from './use-live-stroke-store';
import { useSelectionStore } from './use-selection-store';
import { useSpacePan } from './use-space-pan';
import { GestureArbiter } from './gesture-arbiter';
import { useCanvasShortcuts } from './canvas-shortcuts';
import { useCanvasPasteAndDrop } from './canvas-paste-drop';
import { useTextEditingStore } from './use-text-editing-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { requestEquationFocus } from './equation-focus';
import { useVideoPlayingStore } from './use-video-playing-store';
import {
  useEndCropWhenGone,
  useImageCroppingStore,
} from './use-image-cropping-store';
import { useToolStore } from './use-tool-store';
import { useToolLockStore } from './use-tool-lock-store';
import { useWheel } from './use-wheel';
import { registerPageSwitchInteractionCompleter } from './page-transition';
import { canvasObjectLabel } from './object-navigator';

type EquationItem = { id: string; label: string; locked: boolean };
const EMPTY_EQUATION_ITEMS: EquationItem[] = [];

// Equation menu items, cached against the shape object they were derived from.
// The document hands out a fresh `shapes` array on every mutation but keeps
// unchanged shapes reference-stable, so keying the cache off the shape means
// dragging an unrelated box no longer re-trims and re-normalises every
// equation's label — once a page holds one equation, that ran on every
// published frame of the drag, menu open or not.
const equationItemCache = new WeakMap<Shape, EquationItem>();
function equationItem(shape: Extract<Shape, { type: 'equation' }>) {
  const cached = equationItemCache.get(shape);
  if (cached) return cached;
  const item: EquationItem = {
    id: shape.id,
    label: shape.props.latex.trim().replace(/\s+/g, ' ') || 'Empty equation',
    locked: Boolean(shape.locked),
  };
  equationItemCache.set(shape, item);
  return item;
}

/** Stable empty page for the equation-free path (see `hasEquations`). */
const NO_SHAPES: Shape[] = [];

/**
 * The zoom readout and the equation menu, subscribed here rather than in
 * `Canvas`: a zoom changes the readout and an edit can change the menu, and
 * neither has any business re-rendering the canvas around them.
 */
function LiveCanvasControls(
  props: Omit<ComponentProps<typeof CanvasControls>, 'zoom' | 'equations'>,
) {
  const zoom = useCameraStore((s) => s.camera.z);
  const hasEquations = useDocumentStore((s) => s.hasEquations);
  const hidden = useHiddenStore((s) => s.hidden);
  // Only a page holding an equation has a menu to keep current, so only then
  // does this follow every edit.
  const shapes = useStoreValue(
    () => (hasEquations ? shapeStore.sorted.get() : NO_SHAPES),
    [hasEquations],
  );
  const equations = useMemo(
    () =>
      hasEquations
        ? shapes
            .filter(
              (shape): shape is Extract<Shape, { type: 'equation' }> =>
                shape.type === 'equation' && !hidden[shape.id],
            )
            .map(equationItem)
        : EMPTY_EQUATION_ITEMS,
    [hasEquations, hidden, shapes],
  );
  return <CanvasControls {...props} zoom={zoom} equations={equations} />;
}

/**
 * Reroutes arrows bound to whatever the last edit moved. Its own component so
 * that the per-edit `shapes` subscription this needs re-renders nothing else —
 * `Canvas` used to hold it, and so re-rendered on every drag frame and every
 * peer edit.
 */
/** Lookups against the same published snapshot `useShapes` returns. */
const publishedById = { get: (id: string) => shapeStore.peek(id) };

function BoundArrowSync() {
  const shapes = useShapes();
  // Layout, not passive: this rewrites bound arrow geometry in a *second*
  // transaction, after the one that moved the target. As a `useEffect` that
  // landed after paint, so dragging a bound shape painted a frame with the
  // shape in its new position and its arrow still routed to the old one — a
  // visible tear every frame of the drag. Running before paint means React
  // re-renders with the repaired geometry inside the same commit, so the torn
  // state is never shown. Same work, same transaction count; only the timing.
  useLayoutEffect(() => {
    // Only arrows bound to something that actually changed can need
    // re-resolving; `null` means "rescan everything" after a load or resync.
    const changed = takeBindingDirty();
    syncBoundArrows(
      shapes,
      editor,
      changed === null ? null : bindingGraph.expand(changed),
      publishedById,
    );
  }, [shapes]);
  return null;
}

/**
 * While the camera moves, an invisible blocker captures pointer hit-tests so
 * the browser doesn't walk the overlay trees — selection handles, comment
 * pins, peer cursors — every frame. The shape layer opts out of hit-testing
 * outright and never needed this. Pointer and wheel events still bubble to the
 * container's handlers below it.
 *
 * Its own component so that a gesture starting and settling toggles this div
 * rather than re-rendering the canvas.
 */
function CameraMovingBlocker() {
  const moving = useCameraInteraction((s) => s.isMoving);
  return moving ? (
    <div className="absolute inset-0 z-[var(--z-canvas-blocker)]" />
  ) : null;
}

/** The grid follows every camera frame, so it subscribes on its own. */
function LiveBackground(props: Omit<ComponentProps<typeof Background>, 'camera'>) {
  const camera = useCameraStore((s) => s.camera);
  return <Background {...props} camera={camera} />;
}

function CanvasSelectionStatus() {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const activeToolId = useToolStore((state) => state.activeToolId);
  const toolLabel = toolRegistry.get(activeToolId)?.label ?? activeToolId;
  let message = 'No objects selected.';
  if (selectedIds.length === 1) {
    const shape = editor.getShape(selectedIds[0]!);
    message = shape
      ? shape.type === 'equation'
        ? shape.locked
          ? 'Locked equation selected.'
          : 'Equation selected. Press Enter to edit.'
        : `${canvasObjectLabel(shape, 0)} selected.`
      : 'No objects selected.';
  } else if (selectedIds.length > 1) {
    message = `${selectedIds.length} objects selected.`;
  }

  return (
    <span className="sr-only" role="status" aria-live="polite">
      {`${toolLabel} tool. ${message}`}
    </span>
  );
}

export function Canvas() {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  // Keeps the container's viewport rectangle measured, so turning a pointer
  // sample into canvas coordinates doesn't force a layout on every move.
  useContainerRect(containerRef);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useLayoutEffect(() => {
    useCameraStore.getState().setViewportSize(size.width, size.height);
  }, [size.width, size.height]);
  const following = useFollowStore((s) => s.following);
  const lastSummonApplied = useFollowStore((s) => s.lastSummonApplied);
  const background = useCanvasUiStore((s) => s.background);
  const setBackground = useCanvasUiStore((s) => s.setBackground);
  const minimapVisible = useCanvasUiStore((s) => s.minimapVisible);
  const setMinimapVisible = useCanvasUiStore((s) => s.setMinimapVisible);
  const debugPerformance = useCanvasUiStore((s) => s.debugPerformance);
  const activeToolId = useToolStore((s) => s.activeToolId);
  // TEMPORARY perf harness — delete with ./zoom-bench.ts.
  const bench = useBenchFlags();
  const handDragging = useCameraInteraction((s) => s.isHandDragging);
  const pan = useSpacePan(false);
  useWheel(containerRef, false);
  useSafariGestures(containerRef, false);

  // Live viewport center (screen px), read by keyboard zoom shortcuts.
  const centerRef = useRef({ x: 0, y: 0 });
  centerRef.current = { x: size.width / 2, y: size.height / 2 };
  // Only Quick Zoom's frame is React state — it is the one piece of this that
  // has to paint.
  const [quickZoomFrame, setQuickZoomFrame] = useState<{
    center: { x: number; y: number };
    width: number;
    height: number;
  } | null>(null);

  const ctx = useMemo<ToolContext>(
    () => ({
      editor,
      getViewportBounds: () => {
        const currentSize = sizeRef.current;
        return viewportWorldBounds(
          useCameraStore.getState().camera,
          currentSize.width,
          currentSize.height,
        );
      },
      setTool: useToolStore.getState().setTool,
      complete: () => {
        if (!useToolLockStore.getState().locked) {
          useToolStore.getState().setTool('select');
        }
      },
    }),
    [],
  );

  const editingId = useTextEditingStore((s) => s.editingId);
  const frameEditingId = useFrameEditingStore((s) => s.editingId);
  const playingId = useVideoPlayingStore((s) => s.playingId);
  const croppingId = useImageCroppingStore((s) => s.croppingId);
  // The stroke the local pointer is drawing, if any. `ActiveStrokeLayer` draws
  // it instead of the tree below, so it is filtered out of both for as long as
  // that lasts. Changes twice per stroke, not per frame.
  const liveStrokeId = useLiveStrokeShapeId();
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  // Each of these follows its one shape, and re-renders the canvas only when
  // that shape changes.
  const editingShape = useShape(editingId);
  const frameEditingShape = useShape(frameEditingId);
  const playingShape = useShape(playingId);
  const croppingShape = useShape(croppingId);
  useEndCropWhenGone();
  // Only the four tutor fields the follow and summon effects below actually
  // read. publishPeers keeps unchanged peer objects reference-stable, so
  // selecting the whole tutor already held while *other* peers moved — but the
  // tutor's own cursor (25 Hz), laser, selection, voice and attention each
  // replace that object, and every one of them re-rendered the whole Canvas.
  // Projecting the four fields under `useShallow` narrows the wake-ups to the
  // ones with a consumer here; `viewport` keeps its own reference until the
  // tutor republishes it, so following still updates on the frame it should.
  const { tutorClientId, tutorViewport, tutorSummon, tutorPage } =
    usePresenceStore(
      useShallow((s) => {
        const tutor = s.peers.find((peer) => peer.isTutor) ?? null;
        return {
          tutorClientId: tutor?.clientId ?? null,
          tutorViewport: tutor?.viewport ?? null,
          tutorSummon: tutor?.summon ?? null,
          tutorPage: tutor?.page ?? null,
        };
      }),
    );
  const summonBaselineReady = useRef(false);

  const [arbiter] = useState(() => new GestureArbiter());

  const activeTool = () =>
    toolRegistry.get(useToolStore.getState().activeToolId);

  useEffect(() => useCameraStore.subscribe((next, prev) => {
    if (next.camera === prev.camera || next.activeKey !== prev.activeKey) return;
    const screen = arbiter.pointer;
    if (screen) setLocalCursor(screenToWorld(screen, next.camera));
    arbiter.dispatchSyntheticMove();
  }), [arbiter]);

  const edgeScroll = useEdgeScroll({
    getViewportSize: () => sizeRef.current,
    onScroll: arbiter.dispatchSyntheticMove,
  });

  arbiter.host = {
    ctx,
    pan,
    edgeScroll,
    container: () => containerRef.current,
    viewportSize: () => sizeRef.current,
    setQuickZoomFrame,
  };

  useEffect(
    () => registerPageSwitchInteractionCompleter(arbiter.abandonAll),
    [arbiter],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (pan.isSpaceDown || !arbiter.isSurfaceEvent(e.target)) return;
      activeTool()?.onDoubleClick?.(arbiter.toInfo(e), ctx);
    },
    [pan, ctx, arbiter],
  );

  // Right-click selects the shape under the cursor (so the context menu acts on
  // it). Does not preventDefault — the context menu opens normally.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      // The press this belongs to is either still choosing between a menu and a
      // pan, or has already been answered by `replayContextMenu`. Stopping
      // propagation is what keeps it from the trigger wrapping this element;
      // preventing the default is what keeps the browser's own menu shut.
      if (arbiter.takeContextMenuSwallow()) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!arbiter.isSurfaceEvent(e.target)) {
        setContextMenuPoint(null);
        return;
      }
      const info = arbiter.toInfo(e);
      setContextMenuPoint(info.point);
      const tol = 4 / useCameraStore.getState().camera.z;
      const shapes = editor.getShapes();
      const isHidden = useHiddenStore.getState().isHidden;
      const hitId =
        hitTestCanvas(shapes, spatialIndex, info.point, tol, {
          zoom: useCameraStore.getState().camera.z,
          isEligible: (shape) => !isHidden(shape.id),
          isHidden,
        })?.id ?? null;
      const sel = useSelectionStore.getState();
      if (hitId) {
        if (!sel.selectedIds.includes(hitId)) sel.setSelection([hitId]);
        return;
      }
      // No shape under the cursor. Keep the current selection if the click lands
      // inside its (possibly rotated) bounding box, so a multi-selection's
      // context menu still targets it (tldraw behaviour); otherwise clear.
      const selInfo = getSelectionInfo(
        shapes,
        sel.selectedIds,
        useCameraStore.getState().camera.z,
        editor.getShape,
      );
      if (selInfo) {
        const { nw, ne, se, sw } = selInfo.corners;
        if (pointInPolygon(info.point, [nw, ne, se, sw])) return;
      }
      sel.clear();
    },
    [arbiter],
  );

  // Publish our viewport so peers following us can mirror it. A store
  // listener rather than an effect on the camera, so the canvas does not have
  // to re-render on every camera frame to notice one.
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    const viewport = { width: size.width, height: size.height };
    setLocalViewport(useCameraStore.getState().camera, viewport);
    return useCameraStore.subscribe((next, prev) => {
      if (next.camera !== prev.camera) setLocalViewport(next.camera, viewport);
    });
  }, [size.width, size.height]);

  // Broadcast our follow state so the tutor can see who is following.
  useEffect(() => {
    setLocalFollowing(following);
  }, [following]);

  // Presence keeps the cursor position and glyph separate so existing peers
  // can fall back to the normal pointer while eraser-aware peers show a cross.
  useEffect(() => {
    setLocalCursorType(activeToolId === 'eraser' ? 'cross' : 'pointer');
  }, [activeToolId]);

  // The first frame of a follow glides into the tutor's view so the student
  // sees where they went; every update after that mirrors it exactly.
  const followGlided = useRef(false);
  useEffect(() => {
    if (!following) {
      followGlided.current = false;
      return;
    }
    if (tutorClientId === null) {
      useFollowStore.getState().setFollowing(false);
      return;
    }
    // Follow the tutor across pages, then mirror their viewport.
    if (tutorPage && tutorPage !== currentPageId) {
      setCurrentPageForFollow(tutorPage);
    }
    if (!tutorViewport || size.width <= 0 || size.height <= 0) return;
    const bounds = viewportWorldBounds(
      tutorViewport.camera,
      tutorViewport.size.width,
      tutorViewport.size.height,
    );
    const camera = useCameraStore.getState();
    if (followGlided.current) {
      camera.zoomToBounds(bounds, size.width, size.height, 1);
    } else {
      followGlided.current = true;
      camera.animateToBounds(bounds, size.width, size.height, 1);
    }
  }, [
    following,
    tutorClientId,
    tutorViewport,
    tutorPage,
    currentPageId,
    size.width,
    size.height,
  ]);

  useEffect(() => {
    if (tutorClientId === null) {
      summonBaselineReady.current = false;
      return;
    }
    if (!summonBaselineReady.current) {
      if (tutorSummon !== null) {
        useFollowStore.getState().setLastSummonApplied(tutorSummon);
      }
      summonBaselineReady.current = true;
      return;
    }
    if (
      tutorSummon === null ||
      tutorSummon <= lastSummonApplied ||
      !tutorViewport ||
      size.width <= 0 ||
      size.height <= 0
    ) {
      return;
    }
    // A summon moves you to the tutor's page, then eases into their viewport.
    if (tutorPage && tutorPage !== currentPageId) setCurrentPage(tutorPage);
    const bounds = viewportWorldBounds(
      tutorViewport.camera,
      tutorViewport.size.width,
      tutorViewport.size.height,
    );
    useCameraStore
      .getState()
      .animateToBounds(bounds, size.width, size.height, 1);
    useFollowStore.getState().setLastSummonApplied(tutorSummon);
  }, [
    tutorClientId,
    tutorSummon,
    tutorViewport,
    tutorPage,
    currentPageId,
    lastSummonApplied,
    size.width,
    size.height,
  ]);

  // Clear selection whenever we leave the select tool.
  useEffect(() => {
    if (activeToolId !== 'select') useSelectionStore.getState().clear();
  }, [activeToolId]);

  useEffect(
    () =>
      subscribeCanvasZoomToBounds((bounds) => {
        const viewport = sizeRef.current;
        if (viewport.width <= 0 || viewport.height <= 0) return;
        stopFollowingForManualCameraChange();
        useCameraStore
          .getState()
          .animateToBounds(bounds, viewport.width, viewport.height, 0.75);
      }),
    [],
  );

  // Drop any pending long-press timer on unmount.
  useEffect(() => () => arbiter.dispose(), [arbiter]);

  // Tool lifecycle: enter the active tool, and run the previous tool's onExit on
  // switch (the effect cleanup). Lets a tool tear down in-progress state — e.g.
  // the eraser cancels its pending stroke when you switch away or press Escape.
  useEffect(() => {
    const tool = toolRegistry.get(activeToolId);
    tool?.onEnter?.(ctx);
    return () => tool?.onExit?.(ctx);
  }, [activeToolId, ctx]);

  /**
   * Frame the selection. Pressed at 100% it fits the selection to the viewport;
   * pressed anywhere else it returns to 100% centred on the selection, so the
   * shortcut toggles between "show me all of it" and "show it at true size"
   * instead of doing nothing the second time it is pressed.
   */
  const onZoomToSelection = useCallback(() => {
    const ids = useSelectionStore.getState().selectedIds;
    const { width, height } = sizeRef.current;
    if (!ids.length || width <= 0 || height <= 0) return;
    const s = useCameraStore.getState();
    const info = getSelectionInfo(
      editor.getShapes(),
      ids,
      s.camera.z,
      editor.getShape,
    );
    if (!info) return;
    stopFollowingForManualCameraChange();
    if (isActualSize(s.camera.z)) {
      s.animateToBounds(info.bounds, width, height);
    } else {
      s.animateCenterOn(info.center, 1);
    }
  }, []);

  /** Frame everything on the page, or return to the origin on an empty page. */
  const onZoomToFit = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    const bounds = spatialIndex.totalBounds();
    const { width, height } = sizeRef.current;
    if (!bounds) s.reset();
    else s.animateToBounds(bounds, width, height);
  }, []);

  useCanvasShortcuts({
    ctx,
    arbiter,
    centerRef,
    onZoomToFit,
    onZoomToSelection,
  });

  const { onDragOver, onDrop } = useCanvasPasteAndDrop({
    arbiter,
    centerRef,
    sizeRef,
    containerRef,
  });

  // Zoom controls.
  const center = useCallback(
    () => ({ x: size.width / 2, y: size.height / 2 }),
    [size.width, size.height],
  );
  const onZoomIn = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.animateZoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'in', s.baseZoom));
  }, [center]);
  const onZoomOut = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.animateZoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'out', s.baseZoom));
  }, [center]);
  const onZoomReset = useCallback(() => {
    stopFollowingForManualCameraChange();
    useCameraStore.getState().animateZoomAtScreen(center(), 1);
  }, [center]);
  const onEquationSelect = useCallback(
    (id: string) => {
      const shape = editor.getShape(id);
      if (!shape || shape.type !== 'equation') return;
      useToolStore.getState().setTool('select');
      useSelectionStore.getState().setSelection([id]);
      stopFollowingForManualCameraChange();
      useCameraStore
        .getState()
        .animateToBounds(
          shapeRotatedBounds(shape),
          size.width,
          size.height,
          0.75,
        );
      if (!shape.locked) requestEquationFocus(id);
    },
    [size.height, size.width],
  );

  const toolCursor = toolRegistry.get(activeToolId)?.cursor ?? 'default';
  const gestureCursor = useSelectionStore((state) => state.gestureCursor);
  const showDrawingCursor = activeToolId === 'draw' && !pan.isSpaceDown;
  const showLaserCursor = activeToolId === 'laser' && !pan.isSpaceDown;
  const showEraserCursor = activeToolId === 'eraser' && !pan.isSpaceDown;
  const cursor =
    pan.isPanning || handDragging
      ? 'grabbing'
      : pan.isSpaceDown
        ? 'grab'
        : showDrawingCursor || showLaserCursor || showEraserCursor
          ? 'none'
          : (gestureCursor ?? toolCursor);

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      role="region"
      aria-label="Whiteboard canvas"
      aria-describedby="canvas-keyboard-help"
      tabIndex={0}
      className="wb-canvas-surface absolute inset-0 z-[var(--z-canvas)] overflow-hidden bg-canvas"
      style={{ touchAction: 'none', cursor }}
      onPointerDown={arbiter.onPointerDown}
      onPointerMove={arbiter.onPointerMove}
      onPointerUp={arbiter.onPointerUp}
      onPointerCancel={arbiter.onPointerCancel}
      onLostPointerCapture={arbiter.onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerEnter={(e) => arbiter.publishCursorPosition(e.clientX, e.clientY)}
      onPointerLeave={(e) => {
        // Unconditional, unlike the cursor below: leaving the surface for a
        // floating panel still means the pointer is no longer over a shape.
        clearHover();
        const rect = getContainerRect(containerRef.current);
        const stillInsideViewport =
          rect &&
          e.clientX >= rect.left &&
          e.clientX < rect.right &&
          e.clientY >= rect.top &&
          e.clientY < rect.bottom;
        // Overlay controls are siblings of the canvas, which fires a leave even
        // though the pointer is still inside the board viewport. Keep the last
        // cursor position until the pointer actually leaves the viewport.
        if (stillInsideViewport) return;
        setLocalCursor(null);
        arbiter.pointer = null;
      }}
    >
      <span id="canvas-keyboard-help" className="sr-only">
        Use the toolbars or single-key tool shortcuts to work on the board. Open
        Board actions, then Keyboard shortcuts, for the complete reference.
      </span>
      <CanvasSelectionStatus />
      <BoundArrowSync />
      {/* TEMPORARY bench flag — delete with ./zoom-bench.ts. */}
      {!bench.noBg && (
        <LiveBackground
          type={background}
          width={size.width}
          height={size.height}
        />
      )}

      {!bench.noShapes && (
        <ShapeLayer
          key={currentPageId}
          width={size.width}
          height={size.height}
        />
      )}

      {/* Mounted only while the local pointer is drawing, and paired with the
          `liveStrokeId` filter above so exactly one of the two draws that
          stroke. Its own element, so a stroke's per-frame churn never dirties
          the raster of the page-sized SVG behind it. */}
      {liveStrokeId && <ActiveStrokeLayer />}

      {/* Mounts only while something is fading out after a delete. */}
      <VanishLayer />

      <CameraMovingBlocker />

      <PeerSelectionLayer />
      {activeToolId === 'select' && !editingShape && !frameEditingShape && (
        <HoverLayer />
      )}
      {!editingShape && !frameEditingShape && <SelectionLayer />}
      {!editingShape && !frameEditingShape && <SelectionToolbar />}
      <CursorsLayer viewportSize={size} />
      <LaserLayer />
      <MeasureLayer />
      <EraserTrail />
      <CommentsLayer />
      {quickZoomFrame && (
        <QuickZoomFrame
          center={quickZoomFrame.center}
          width={quickZoomFrame.width}
          height={quickZoomFrame.height}
        />
      )}
      {showDrawingCursor && <DrawingCursor containerRef={containerRef} />}
      {showLaserCursor && <LaserCursor containerRef={containerRef} />}
      {showEraserCursor && <EraserCursor containerRef={containerRef} />}

      {editingShape?.type === 'text' && (
        <TextEditorOverlay shape={editingShape} />
      )}

      {frameEditingShape?.type === 'frame' && (
        <FrameTitleEditorOverlay shape={frameEditingShape} />
      )}

      {playingShape?.type === 'video' && (
        <VideoPlayerOverlay shape={playingShape} />
      )}

      {croppingShape?.type === 'image' && (
        <ImageCropOverlay shape={croppingShape} />
      )}

      {minimapVisible && <Minimap />}

      <LiveCanvasControls
        background={background}
        onBackgroundChange={setBackground}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onZoomToFit={onZoomToFit}
        minimapVisible={minimapVisible}
        onMinimapToggle={() => setMinimapVisible(!minimapVisible)}
        onEquationSelect={onEquationSelect}
      />

      {debugPerformance && <PerformanceOverlay />}
    </div>
  );
}
