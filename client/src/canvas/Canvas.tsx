import { useCallback, useEffect, useMemo, useRef } from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from 'react';
import { type Shape, pointInPolygon } from '@whiteboard/shared';
import './shapes/register';
import './tools/register';
import { Background } from './Background';
import { CanvasControls } from './CanvasControls';
import { UndoControls } from './UndoControls';
import {
  cameraToTransform,
  nextDiscreteZoom,
  screenToWorld,
} from './camera';
import { quantizedCullRegion, viewportWorldBounds } from './geometry';
import { PerformanceOverlay } from '@/components/performance-overlay';
import { CursorsLayer } from '@/collab/CursorsLayer';
import { PeerSelectionLayer } from '@/collab/PeerSelectionLayer';
import { CommentsLayer } from './CommentsLayer';
import { DrawingCursor } from './DrawingCursor';
import { LaserLayer } from './LaserLayer';
import {
  getLocalUser,
  setLocalCursor,
  setLocalFollowing,
  setLocalViewport,
} from '@/collab/presence';
import {
  stopFollowingForManualCameraChange,
  useFollowStore,
} from '@/collab/use-follow-store';
import { usePresenceStore } from '@/collab/use-presence-store';
import { ShapeView } from './ShapeView';
import { FrameView } from './shapes/frame';
import { plotArea } from './shapes/graph';
import { panViewport, zoomViewport } from './shapes/graph-interaction';
import { SelectionLayer } from './SelectionLayer';
import { SelectionToolbar } from './SelectionToolbar';
import { TextEditorOverlay } from './TextEditorOverlay';
import { VideoPlayerOverlay } from './VideoPlayerOverlay';
import { ImageCropOverlay } from './ImageCropOverlay';
import { toolRegistry } from './tools/tool-registry';
import type { ToolContext, ToolPointerInfo } from './tools/types';
import { duplicateShapes, groupShapes, ungroupShapes } from './commands';
import {
  clipboardToken,
  copyShapes,
  hasClipboard,
  pasteShapes,
  wbClipToken,
} from './clipboard';
import { writeShapesToOsClipboard } from '@/board/clipboard-os';
import { addFilesToRepository } from '@/board/documents';
import { useDocumentsStore } from './use-documents-store';
import { deleteTargetIds } from './hierarchy';
import { placeImageFiles } from './place-image';
import { createYoutubeShape, parseYoutubeId } from './place-video';
import { useEnteredGroupStore } from './use-entered-group-store';
import {
  breakUndoCapture,
  editor,
  redo,
  setCurrentPage,
  setCurrentPageForFollow,
  spatialIndex,
  undo,
  useDocumentStore,
  useUndoStore,
} from './use-document-store';
import { shapeRegistry } from './shapes/shape-registry';
import { syncBoundArrows } from './shapes/connector-routing';
import { useCameraStore } from './use-camera-store';
import { subscribeCanvasZoomToBounds } from './camera-requests';
import { useCameraInteraction } from './use-camera-interaction';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { useElementSize } from './use-element-size';
import { useSafariGestures } from './use-safari-gestures';
import { copySelectionToPngClipboard } from './export-png';
import { getSelectionInfo } from './selection-geometry';
import { shapeRotatedBounds } from './shape-bounds';
import { isSelectable } from './selectable';
import { resolveOpacity } from './opacity';
import { useEraserStore } from './use-eraser-store';
import { useHiddenStore } from './use-hidden-store';
import { useSelectionStore } from './use-selection-store';
import { useSpacePan } from './use-space-pan';
import { useTextEditingStore } from './use-text-editing-store';
import { requestEquationFocus } from './equation-focus';
import { useVideoPlayingStore } from './use-video-playing-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useToolStore } from './use-tool-store';
import { useToolLockStore } from './use-tool-lock-store';
import {
  TOUCH_PAN_SPEED,
  pinchGesture,
  pruneStaleTouches,
  zoomFromDistance,
  type PinchState,
} from './pinch';
import { useWheel } from './use-wheel';
import { registerPageSwitchInteractionCompleter } from './page-transition';
import { canvasObjectLabel } from './object-navigator';
import {
  bringForward,
  bringToFront,
  sendBackward,
  sendToBack,
} from './z-order';

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (el.tagName === 'INPUT' ||
      el.tagName === 'TEXTAREA' ||
      // The graph panel's MathLive field edits inside its shadow DOM, so events
      // retarget to the <math-field> host rather than a focusable input.
      !!el.closest?.('math-field') ||
      el.isContentEditable)
  );
}

function isTouchPointer(e: ReactPointerEvent): boolean {
  return e.pointerType === 'touch';
}

// A touch/pen that hasn't fired an event in this long is treated as released,
// even without a pointerup/cancel — recovers from iOS dropping those events.
const STALE_TOUCH_MS = 2000;

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
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const camera = useCameraStore((s) => s.camera);
  const following = useFollowStore((s) => s.following);
  const lastSummonApplied = useFollowStore((s) => s.lastSummonApplied);
  const background = useCanvasUiStore((s) => s.background);
  const setBackground = useCanvasUiStore((s) => s.setBackground);
  const debugPerformance = useCanvasUiStore((s) => s.debugPerformance);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const cameraMoving = useCameraInteraction((s) => s.isMoving);
  const handDragging = useCameraInteraction((s) => s.isHandDragging);
  const pan = useSpacePan(false);
  useWheel(containerRef, false);
  useSafariGestures(containerRef, false);

  // Which gesture owns the current pointer interaction.
  const gesture = useRef<'pan' | 'tool' | null>(null);
  // The pointer currently driving `gesture` (so stray pointers are ignored).
  const toolPointerId = useRef<number | null>(null);
  // Live touch pointers on the surface, id → last-seen position (container px) and
  // timestamp. Drives single- vs multi-touch routing and the pinch math. iOS
  // routinely drops pointerup/cancel when the OS steals a gesture, so entries are
  // pruned by `reconcileStaleTouches` rather than trusted to clear themselves.
  const activeTouches = useRef<Map<number, { x: number; y: number; t: number }>>(
    new Map(),
  );
  // A pen (Apple Pencil) is down: finger touches are palm-rejected while it is.
  const penActive = useRef(false);
  // Last time any pen event was seen — lets a dropped pen-up self-heal.
  const penLastSeen = useRef(0);
  // The active two-finger pinch, or null. Owns the camera while ≥2 fingers are down.
  const pinch = useRef<PinchState | null>(null);
  // When a pinch begins over a selected graph, its id — the pinch then drives
  // that graph's viewport instead of the board camera (null = board pinch).
  const pinchGraphId = useRef<string | null>(null);
  // Finger separation last frame, for incremental graph-viewport zoom.
  const pinchLastDistance = useRef(0);
  // Latched once ≥2 fingers touch, cleared only when all lift — suppresses tool
  // routing for the rest of a pinch so lifting one finger never draws a stray mark.
  const pinchLatch = useRef(false);
  // Long-press → context menu (touch has no right-click).
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  // Live viewport center (screen px), read by keyboard zoom shortcuts.
  const centerRef = useRef({ x: 0, y: 0 });
  centerRef.current = { x: size.width / 2, y: size.height / 2 };
  // Last pointer position in container pixels; paste lands here (null = off-canvas).
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

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
  const playingId = useVideoPlayingStore((s) => s.playingId);
  const croppingId = useImageCroppingStore((s) => s.croppingId);
  const hidden = useHiddenStore((s) => s.hidden);
  const erasing = useEraserStore((s) => s.marked);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const liveShapesRecord = useDocumentStore(
    (s) => s.doc.pages[s.currentPageId]?.shapes,
  );
  // Shared, pre-sorted array from the store (stable across camera-only renders).
  const liveShapes = useDocumentStore((s) => s.shapes);
  const shapes = liveShapes;
  useEffect(() => {
    syncBoundArrows(liveShapes, editor);
  }, [liveShapes]);
  const equationItems = useMemo(
    () =>
      shapes
        .filter(
          (shape): shape is Extract<Shape, { type: 'equation' }> =>
            shape.type === 'equation' && !hidden[shape.id],
        )
        .map((shape) => ({
          id: shape.id,
          label:
            shape.props.latex.trim().replace(/\s+/g, ' ') || 'Empty equation',
          locked: Boolean(shape.locked),
        })),
    [hidden, shapes],
  );
  const shapesRecord = useMemo<Record<string, Shape>>(() => {
    return liveShapesRecord ?? {};
  }, [liveShapesRecord]);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);

  // Shape-graph derivations that depend only on the shapes — never on the
  // camera. Memoizing them keeps the pan/zoom hot path (which re-renders this
  // component on every frame) from re-walking the hierarchy each time:
  //  - `childrenByParent`: parent id → its children, already in index order
  //    (`shapes` is globally sorted, so each bucket is sorted for free).
  //  - `frameAncestorIds`: shapes that live under a frame, excluded from the
  //    flat top-level pass (they render inside their frame's clip).
  const { childrenByParent, frameAncestorIds } = useMemo(() => {
    const childrenByParent = new Map<string, Shape[]>();
    for (const s of shapes) {
      if (!s.parentId) continue;
      const bucket = childrenByParent.get(s.parentId);
      if (bucket) bucket.push(s);
      else childrenByParent.set(s.parentId, [s]);
    }
    const frameAncestorIds = new Set<string>();
    for (const s of shapes) {
      let cur = s.parentId ? shapesRecord?.[s.parentId] : undefined;
      // Most shapes have no parent — skip the per-shape Set until a walk starts.
      if (!cur) continue;
      const seen = new Set<string>();
      while (cur && !seen.has(cur.id)) {
        if (cur.type === 'frame') {
          frameAncestorIds.add(s.id);
          break;
        }
        seen.add(cur.id);
        cur = cur.parentId ? shapesRecord?.[cur.parentId] : undefined;
      }
    }
    return { childrenByParent, frameAncestorIds };
  }, [shapes, shapesRecord]);

  // Viewport culling. The search region is overscanned past the viewport and
  // snapped to a coarse grid (see `quantizedCullRegion`), so panning within a
  // grid cell reuses the same visible set instead of re-searching the spatial
  // index and re-filtering the whole document every frame. `cullKey` is the
  // primitive form of that region, used as the memo dependency so sub-cell
  // camera frames don't invalidate it. `shapes` is also a dependency because the
  // spatial index moves in lockstep with it.
  const cullRegion =
    size.width > 0 && size.height > 0
      ? quantizedCullRegion(camera, size.width, size.height)
      : null;
  const cullKey = cullRegion
    ? `${cullRegion.minX}:${cullRegion.minY}:${cullRegion.maxX}:${cullRegion.maxY}`
    : '';

  const visibleShapes = useMemo(() => {
    let base = shapes;
    if (cullRegion) {
      const ids = new Set(spatialIndex.search(cullRegion));
      base = shapes.filter((s) => ids.has(s.id));
    }
    return base.filter(
      (s) =>
        s.id !== editingId &&
        s.id !== playingId &&
        s.id !== croppingId &&
        !hidden[s.id],
    );
    // `cullKey` stands in for `cullRegion` (stable across sub-cell pans).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cullKey, shapes, editingId, playingId, croppingId, hidden]);

  const topLevelShapes = useMemo(
    () => visibleShapes.filter((s) => !frameAncestorIds.has(s.id)),
    [visibleShapes, frameAncestorIds],
  );

  // The rendered element tree. Memoized so a pan/zoom that doesn't change the
  // visible set produces a referentially-stable child array — React then skips
  // reconciling the shape `<g>` entirely and only updates its transform.
  //
  // Render opacity (ancestor compounding + eraser dim) is resolved here rather
  // than in a document-wide map, because only the shapes this tree mounts need
  // it: the culled set plus each visible frame's children. Deriving it for the
  // whole page instead cost an N-entry map on every stroke frame, and scoping
  // that map to `visibleShapes` would have been wrong — a frame's children are
  // rendered through `childrenByParent` even when culled out of that set.
  // Every dependency below is stable across camera-only renders, so panning
  // still reuses this array and ShapeView's memo still holds.
  const renderedShapes = useMemo(() => {
    const getShape = (id: string) => shapesRecord?.[id];
    const isMarked = (id: string) => !!erasing[id];
    const renderShape = (shape: Shape): ReactNode =>
      shape.type === 'frame' ? (
        <FrameView
          key={shape.id}
          frame={shape}
          opacity={resolveOpacity(shape, getShape, isMarked)}
        >
          {(childrenByParent.get(shape.id) ?? [])
            .filter(
              (s) =>
                s.id !== editingId &&
                s.id !== playingId &&
                s.id !== croppingId &&
                !hidden[s.id],
            )
            .map(renderShape)}
        </FrameView>
      ) : (
        <ShapeView
          key={shape.id}
          shape={shape}
          opacity={resolveOpacity(shape, getShape, isMarked)}
        />
      );
    return topLevelShapes.map(renderShape);
  }, [
    topLevelShapes,
    childrenByParent,
    shapesRecord,
    erasing,
    editingId,
    playingId,
    croppingId,
    hidden,
  ]);

  const editingShape = editingId ? shapesRecord?.[editingId] : undefined;
  const playingShape = playingId ? shapesRecord?.[playingId] : undefined;
  const croppingShape = croppingId ? shapesRecord?.[croppingId] : undefined;
  // Select only the tutor peer. publishPeers keeps unchanged peer objects
  // reference-stable, so this selector holds (no Canvas re-render) while other
  // peers' cursors stream in — only the tutor's own updates flow through.
  const tutorPeer = usePresenceStore(
    (s) => s.peers.find((peer) => peer.isTutor) ?? null,
  );
  const tutorClientId = tutorPeer?.clientId ?? null;
  const tutorViewport = tutorPeer?.viewport ?? null;
  const tutorSummon = tutorPeer?.summon ?? null;
  const tutorPage = tutorPeer?.page ?? null;
  const summonBaselineReady = useRef(false);

  const toInfo = useCallback(
    (
      e: ReactPointerEvent | ReactMouseEvent | PointerEvent,
      // Optional pre-read container rect. `getBoundingClientRect` forces a
      // synchronous reflow while React is committing shape frames, so callers
      // that process many coalesced samples per event read it once and pass it
      // in rather than paying that cost on every sample.
      rect?: DOMRect,
    ): ToolPointerInfo => {
      const r = rect ?? containerRef.current?.getBoundingClientRect();
      const screen = {
        x: e.clientX - (r?.left ?? 0),
        y: e.clientY - (r?.top ?? 0),
      };
      const camera = useCameraStore.getState().camera;
      const pointerType =
        'pointerType' in e && typeof e.pointerType === 'string'
          ? e.pointerType
          : 'mouse';
      const rawPressure = 'pressure' in e ? e.pressure : 0.5;
      const pressure =
        Number.isFinite(rawPressure) && rawPressure > 0 ? rawPressure : 0.5;
      return {
        point: screenToWorld(screen, camera),
        screenPoint: screen,
        timestamp: e.timeStamp,
        zoom: camera.z,
        pressure,
        pointerType,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        button: e.button,
      };
    },
    [containerRef],
  );

  const activeTool = () => toolRegistry.get(useToolStore.getState().activeToolId);

  // True only for events that originate on the canvas DOM surface — excludes
  // in-canvas floating UI (data-ui-layer) and portaled popups/dialogs, whose
  // React events still bubble here but aren't DOM descendants of the canvas.
  const isSurfaceEvent = useCallback(
    (target: EventTarget | null): boolean => {
      const node = target as HTMLElement | null;
      if (!node || !containerRef.current?.contains(node)) return false;
      return !node.closest('[data-ui-layer]');
    },
    [containerRef],
  );

  // End the active tool/pan gesture, either committing it (the pointer lifted
  // normally) or cancelling it (a pinch/pen stole the interaction).
  const endToolGesture = useCallback(
    (target: Element, mode: 'commit' | 'cancel') => {
      const id = toolPointerId.current;
      const wasToolGesture = gesture.current === 'tool';
      if (wasToolGesture) {
        const tool = activeTool();
        // 'commit' keeps what was drawn (the OS reclaimed a pen/mouse pointer);
        // tools without onCommit fall back to discarding via onCancel.
        if (mode === 'commit' && tool?.onCommit) tool.onCommit(ctx);
        else tool?.onCancel?.(ctx);
        // `pointercancel` and `lostpointercapture` bypass the normal
        // pointer-up path below. They still finish a gesture, so they must end
        // Yjs's capture window or the next stroke can be merged into this one.
        breakUndoCapture();
      }
      if (id !== null && target.hasPointerCapture(id)) {
        target.releasePointerCapture(id);
      }
      gesture.current = null;
      toolPointerId.current = null;
    },
    [ctx],
  );

  const startToolGesture = useCallback(
    (e: ReactPointerEvent) => {
      // Make every new gesture an undo boundary as a fallback for browsers
      // that drop a preceding pointer-up/cancel event.
      breakUndoCapture();
      gesture.current = 'tool';
      toolPointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      activeTool()?.onPointerDown?.(toInfo(e), ctx);
    },
    [toInfo, ctx],
  );

  // A pointer position in container (canvas-relative) pixels.
  const screenPointOf = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = containerRef.current?.getBoundingClientRect();
      return { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
    },
    [containerRef],
  );

  // Publish immediately when the pointer enters or presses the board, not just
  // after it moves. This keeps a peer marker visible for clicks and taps too.
  const publishCursorPosition = useCallback(
    (clientX: number, clientY: number, rect?: DOMRect) => {
      const r = rect ?? containerRef.current?.getBoundingClientRect();
      if (
        !r ||
        clientX < r.left ||
        clientX >= r.right ||
        clientY < r.top ||
        clientY >= r.bottom
      ) {
        return;
      }
      const screen = { x: clientX - r.left, y: clientY - r.top };
      pointerRef.current = screen;
      setLocalCursor(screenToWorld(screen, useCameraStore.getState().camera));
    },
    [containerRef],
  );

  // Drop touch/pen state that no longer reflects a finger on the glass. iOS can
  // swallow the pointerup/cancel that would normally clear it (system gesture,
  // edge swipe, Stage Manager), which would otherwise leave the canvas latched
  // and unresponsive. Pruning on the next interaction lets it self-heal.
  const reconcileStaleTouches = useCallback((now: number) => {
    pruneStaleTouches(activeTouches.current, now, STALE_TOUCH_MS);
    if (activeTouches.current.size < 2) {
      pinch.current = null;
      pinchGraphId.current = null;
    }
    if (activeTouches.current.size === 0) pinchLatch.current = false;
    if (penActive.current && now - penLastSeen.current > STALE_TOUCH_MS) {
      penActive.current = false;
    }
  }, []);

  // The sole selected graph whose plot area contains `screen` (container px), or
  // null. Used to route a pinch to a graph viewport instead of the camera.
  const graphAtScreenPoint = useCallback(
    (screen: { x: number; y: number }): string | null => {
      const sel = useSelectionStore.getState().selectedIds;
      if (sel.length !== 1) return null;
      const shape = editor.getShape(sel[0]!);
      if (!shape || shape.type !== 'graph') return null;
      const world = screenToWorld(screen, useCameraStore.getState().camera);
      const area = plotArea(shape);
      const inside =
        world.x >= area.x &&
        world.x <= area.x + area.w &&
        world.y >= area.y &&
        world.y <= area.y + area.h;
      return inside ? shape.id : null;
    },
    [],
  );

  // Capture the start of a two-finger pinch from the two live touch points.
  const beginPinch = useCallback(() => {
    const pts = [...activeTouches.current.values()];
    if (pts.length < 2) return;
    const g = pinchGesture(pts[0]!, pts[1]!);
    pinch.current = {
      startDistance: g.distance,
      startZoom: useCameraStore.getState().camera.z,
      lastMidpoint: g.midpoint,
    };
    pinchLastDistance.current = g.distance;
    // If the pinch lands inside the sole selected graph's plot, it adjusts that
    // graph's viewport; otherwise it's a normal board pinch.
    pinchGraphId.current = graphAtScreenPoint(g.midpoint);
    if (!pinchGraphId.current) stopFollowingForManualCameraChange();
  }, [graphAtScreenPoint]);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressOrigin.current = null;
  }, []);

  useEffect(
    () =>
      registerPageSwitchInteractionCompleter(() => {
        clearLongPress();
        const target = containerRef.current;
        const pointerId = toolPointerId.current;
        if (gesture.current === 'tool' && target) {
          endToolGesture(target, 'commit');
        } else if (gesture.current === 'pan') {
          gesture.current = null;
          toolPointerId.current = null;
          pan.cancel();
          if (
            target &&
            pointerId !== null &&
            target.hasPointerCapture(pointerId)
          ) {
            target.releasePointerCapture(pointerId);
          }
        }
        if (pinchGraphId.current) breakUndoCapture();
        activeTouches.current.clear();
        pinch.current = null;
        pinchGraphId.current = null;
        pinchLatch.current = false;
        penActive.current = false;
        pointerRef.current = null;
      }),
    [clearLongPress, containerRef, endToolGesture, pan],
  );

  // Arm a long-press on a one-finger touch: holding still for ~500ms aborts the
  // in-progress stroke and opens the context menu (touch has no right-click).
  // Dispatching a native `contextmenu` lets the existing onContextMenu select the
  // shape and the ContextMenuTrigger open — no duplicated logic.
  const armLongPress = useCallback(
    (e: ReactPointerEvent) => {
      const cx = e.clientX;
      const cy = e.clientY;
      const target = e.currentTarget;
      longPressOrigin.current = { x: cx, y: cy };
      longPressTimer.current = window.setTimeout(() => {
        longPressTimer.current = null;
        longPressOrigin.current = null;
        endToolGesture(target, 'cancel');
        const el = document.elementFromPoint(cx, cy) ?? target;
        el.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            clientX: cx,
            clientY: cy,
            view: window,
          }),
        );
      }, 500);
    },
    [endToolGesture],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      publishCursorPosition(e.clientX, e.clientY);

      // Touch: drive the active tool with one finger; two fingers = pinch/pan.
      if (isTouchPointer(e)) {
        reconcileStaleTouches(e.timeStamp);
        if (penActive.current) return; // palm rejection while the pen is down
        activeTouches.current.set(e.pointerId, {
          ...screenPointOf(e),
          t: e.timeStamp,
        });
        if (activeTouches.current.size >= 2) {
          // Second finger down → a pinch is starting: abort the one-finger stroke
          // (the pinch branch in onPointerMove owns the camera now) and mute tool routing.
          pinchLatch.current = true;
          clearLongPress();
          endToolGesture(e.currentTarget, 'cancel');
          beginPinch();
          return;
        }
        if (pinchLatch.current) return; // mid-pinch: wait until all fingers lift
        if (!isSurfaceEvent(e.target)) return;
        startToolGesture(e);
        armLongPress(e);
        return;
      }

      // Mouse / pen.
      if (!isSurfaceEvent(e.target)) return;
      if (e.pointerType === 'pen') {
        penActive.current = true;
        penLastSeen.current = e.timeStamp;
        // A resting finger may have started a stray stroke first — discard it.
        // But a *pen*-started gesture still active here means the previous
        // stroke's pointerup/lostpointercapture was dropped (common on Wacom
        // tablets, which bump the pointerId each stroke); commit that finished
        // stroke, don't delete it.
        if (gesture.current === 'tool' && toolPointerId.current !== e.pointerId) {
          const priorWasTouch =
            toolPointerId.current !== null &&
            activeTouches.current.has(toolPointerId.current);
          endToolGesture(e.currentTarget, priorWasTouch ? 'cancel' : 'commit');
        }
      }
      if (pan.isSpaceDown) {
        stopFollowingForManualCameraChange();
        gesture.current = 'pan';
        toolPointerId.current = e.pointerId;
        pan.onPointerDown(e);
        return;
      }
      startToolGesture(e);
    },
    [
      pan,
      isSurfaceEvent,
      endToolGesture,
      startToolGesture,
      reconcileStaleTouches,
      screenPointOf,
      beginPinch,
      publishCursorPosition,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (isTouchPointer(e) && penActive.current) return;
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        pointerRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      }
      // Skip the presence cursor while pinching (two fingers, jittery midpoint).
      if (rect && !(isTouchPointer(e) && pinchLatch.current)) {
        publishCursorPosition(e.clientX, e.clientY, rect);
      }
      // A real drag past the slop cancels the pending long-press.
      if (longPressOrigin.current) {
        const dx = e.clientX - longPressOrigin.current.x;
        const dy = e.clientY - longPressOrigin.current.y;
        if (Math.hypot(dx, dy) > 10) clearLongPress();
      }
      if (e.pointerType === 'pen') penLastSeen.current = e.timeStamp;
      // Keep each live finger's position fresh and, while two are down, drive the
      // pinch directly from them (single source of truth — no separate Touch
      // Events listener that could desync from this routing).
      if (rect && isTouchPointer(e) && activeTouches.current.has(e.pointerId)) {
        activeTouches.current.set(e.pointerId, {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
          t: e.timeStamp,
        });
        if (pinch.current && activeTouches.current.size >= 2) {
          const pts = [...activeTouches.current.values()];
          const g = pinchGesture(pts[0]!, pts[1]!);
          const graphId = pinchGraphId.current;
          if (graphId) {
            // Drive the graph viewport: spread to zoom in, drag to pan.
            const shape = editor.getShape(graphId);
            if (shape && shape.type === 'graph') {
              const camera = useCameraStore.getState().camera;
              const area = plotArea(shape);
              const world = screenToWorld(g.midpoint, camera);
              const factor =
                g.distance > 0 ? pinchLastDistance.current / g.distance : 1;
              const zoomed = zoomViewport(
                shape.props.viewport,
                area,
                world,
                factor,
              );
              // Content follows the fingers → window moves opposite the midpoint.
              const next = panViewport(
                zoomed,
                area,
                -(g.midpoint.x - pinch.current.lastMidpoint.x) / camera.z,
                -(g.midpoint.y - pinch.current.lastMidpoint.y) / camera.z,
              );
              editor.updateShape(graphId, { props: { viewport: next } });
            }
            pinch.current.lastMidpoint = g.midpoint;
            pinchLastDistance.current = g.distance;
            return;
          }
          useCameraStore
            .getState()
            .zoomAtScreenWithPan(
              g.midpoint,
              zoomFromDistance(
                pinch.current.startZoom,
                pinch.current.startDistance,
                g.distance,
              ),
              (g.midpoint.x - pinch.current.lastMidpoint.x) * TOUCH_PAN_SPEED,
              (g.midpoint.y - pinch.current.lastMidpoint.y) * TOUCH_PAN_SPEED,
            );
          pinch.current.lastMidpoint = g.midpoint;
          return;
        }
      }
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerMove(e);
      } else if (gesture.current === 'tool') {
        // Pointer Events may combine high-frequency hardware samples into one
        // dispatch. Point-accumulating tools (see `wantsCoalescedSamples`) opt
        // into receiving every sample, which preserves pen curves; the draw
        // tool then applies its zoom-aware decimation in world space. Everyone
        // else gets the dispatched position only — for a tool that just tracks
        // where the pointer is, the earlier samples are overwritten in the same
        // frame, so running the full mutation pipeline for each was pure waste.
        const tool = activeTool();
        if (!tool?.onPointerMove) return;
        const coalesced = tool.wantsCoalescedSamples
          ? e.nativeEvent.getCoalescedEvents?.() ?? []
          : [];
        if (coalesced.length) {
          for (const sample of coalesced) {
            tool.onPointerMove(toInfo(sample, rect), ctx);
          }
        }
        const info = toInfo(e.nativeEvent, rect);
        if (tool.wantsPredictedSamples) {
          // Predicted samples ride along on the dispatched move only; they are
          // re-derived every event, so stale predictions never accumulate.
          const predicted = e.nativeEvent.getPredictedEvents?.() ?? [];
          if (predicted.length) {
            info.predicted = predicted.map((sample) => {
              const p = toInfo(sample, rect);
              return {
                x: p.point.x,
                y: p.point.y,
                pressure: p.pressure,
                t: p.timestamp,
              };
            });
          }
        }
        tool.onPointerMove(info, ctx);
      }
    },
    [
      pan,
      toInfo,
      ctx,
      containerRef,
      clearLongPress,
      publishCursorPosition,
    ],
  );

  const releaseTouch = useCallback(
    (e: ReactPointerEvent) => {
      clearLongPress();
      if (e.pointerType === 'pen') penActive.current = false;
      if (isTouchPointer(e)) {
        activeTouches.current.delete(e.pointerId);
        if (activeTouches.current.size < 2) {
          pinch.current = null;
          if (pinchGraphId.current) {
            // End the capture window so the whole pinch is one undo step.
            breakUndoCapture();
            pinchGraphId.current = null;
          }
        }
        if (activeTouches.current.size === 0) pinchLatch.current = false;
      }
    },
    [clearLongPress],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      releaseTouch(e);
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerUp(e);
      } else if (gesture.current === 'tool') {
        activeTool()?.onPointerUp?.(toInfo(e), ctx);
        breakUndoCapture();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }
      gesture.current = null;
      toolPointerId.current = null;
    },
    [pan, toInfo, ctx, releaseTouch],
  );

  // The browser fires pointercancel when it steals a touch (e.g. a pinch is
  // recognized) — abort the in-progress gesture rather than committing it.
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      releaseTouch(e);
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'pan') {
        pan.onPointerUp(e);
        gesture.current = null;
        toolPointerId.current = null;
      } else {
        // A pen/mouse cancel is almost always a spurious OS event, not a real
        // gesture takeover — keep the in-progress stroke/drag. Touch keeps
        // discarding (a genuine pinch is interrupting a one-finger gesture).
        endToolGesture(e.currentTarget, isTouchPointer(e) ? 'cancel' : 'commit');
      }
    },
    [pan, releaseTouch, endToolGesture],
  );

  // Capture being lost (the OS reclaiming the pointer) is a second signal that a
  // touch/pen has gone, in case its pointerup/cancel was dropped. Cleaning up here
  // too keeps the latch from outliving the gesture. Idempotent with releaseTouch.
  const onLostPointerCapture = useCallback(
    (e: ReactPointerEvent) => {
      if (e.pointerType === 'pen') penActive.current = false;
      if (isTouchPointer(e)) {
        activeTouches.current.delete(e.pointerId);
        if (activeTouches.current.size < 2) {
          pinch.current = null;
          if (pinchGraphId.current) {
            breakUndoCapture();
            pinchGraphId.current = null;
          }
        }
        if (activeTouches.current.size === 0) pinchLatch.current = false;
      }
      if (e.pointerId === toolPointerId.current) {
        // Same rationale as onPointerCancel: a pen/mouse losing capture is a
        // spurious OS event, so keep the stroke/drag; touch still discards.
        if (gesture.current === 'tool') {
          endToolGesture(e.currentTarget, isTouchPointer(e) ? 'cancel' : 'commit');
        }
        gesture.current = null;
        toolPointerId.current = null;
      }
    },
    [endToolGesture],
  );

  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      if (pan.isSpaceDown || !isSurfaceEvent(e.target)) return;
      activeTool()?.onDoubleClick?.(toInfo(e), ctx);
    },
    [pan, toInfo, ctx, isSurfaceEvent],
  );

  // Right-click selects the shape under the cursor (so the context menu acts on
  // it). Does not preventDefault — the context menu opens normally.
  const onContextMenu = useCallback(
    (e: ReactMouseEvent) => {
      if (!isSurfaceEvent(e.target)) return;
      const info = toInfo(e);
      const tol = 4 / useCameraStore.getState().camera.z;
      const shapes = editor.getShapes();
      const isHidden = useHiddenStore.getState().isHidden;
      let hitId: string | null = null;
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]!;
        // Right-click can target locked shapes (to unlock them) but not hidden.
        if (isHidden(s.id)) continue;
        if (shapeRegistry.getFor(s)?.hitTest(s, info.point, tol)) {
          hitId = s.id;
          break;
        }
      }
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
    [toInfo, isSurfaceEvent],
  );

  // Clear selection whenever we leave the select tool.
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    setLocalViewport(camera, size);
  }, [camera, size.width, size.height]);

  // Broadcast our follow state so the tutor can see who is following.
  useEffect(() => {
    setLocalFollowing(following);
  }, [following]);

  useEffect(() => {
    if (!following) return;
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
    useCameraStore.getState().zoomToBounds(bounds, size.width, size.height, 1);
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
  useEffect(() => clearLongPress, [clearLongPress]);

  // Tool lifecycle: enter the active tool, and run the previous tool's onExit on
  // switch (the effect cleanup). Lets a tool tear down in-progress state — e.g.
  // the eraser cancels its pending stroke when you switch away or press Escape.
  useEffect(() => {
    const tool = toolRegistry.get(activeToolId);
    tool?.onEnter?.(ctx);
    return () => tool?.onExit?.(ctx);
  }, [activeToolId, ctx]);

  // Keyboard: selection ops, z-order, delete, escape, and tool hotkeys.
  // (Full configurable shortcut sweep is Phase 27.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const ids = useSelectionStore.getState().selectedIds;
      const isModifierKey =
        e.key === 'Shift' || e.key === 'Control' || e.key === 'Meta';

      // Active tools get the first chance at unmodified keys and live modifier
      // changes. The select tool re-tests an in-progress marquee when
      // Shift/Ctrl/Command changes without any pointer movement.
      if ((!mod && !e.altKey) || isModifierKey) {
        const handled = toolRegistry
          .get(useToolStore.getState().activeToolId)
          ?.onKeyDown?.(e, ctx);
        if (handled) return;
      }

      if (mod && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && (e.key === 'y' || e.key === 'Y')) {
        e.preventDefault();
        redo();
        return;
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault();
        if (ids.length) {
          useSelectionStore.getState().setSelection(duplicateShapes(editor, ids));
        }
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useSelectionStore
          .getState()
          .setSelection(
            editor.getShapes().filter(isSelectable).map((s) => s.id),
          );
        return;
      }
      if (mod && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) {
          const freed = ungroupShapes(editor, ids);
          if (freed.length) useSelectionStore.getState().setSelection(freed);
        } else if (ids.length >= 2) {
          const gid = groupShapes(editor, ids);
          if (gid) useSelectionStore.getState().setSelection([gid]);
        }
        return;
      }
      if (mod && e.key === ']') {
        e.preventDefault();
        if (ids.length) (e.shiftKey ? bringToFront : bringForward)(editor, ids);
        return;
      }
      if (mod && e.key === '[') {
        e.preventDefault();
        if (ids.length) (e.shiftKey ? sendToBack : sendBackward)(editor, ids);
        return;
      }
      // Clipboard. Copy/cut also push to the OS clipboard; paste is handled by
      // the window 'paste' listener below so OS-image and in-app paths agree.
      //
      // Shift+Mod+C rasterizes the selection instead (`e.key` is uppercase
      // while shift is held, so this can't collide with the plain copy below).
      // Deliberately not awaited: the clipboard write must be issued while this
      // keydown is still the current task — see `writePngToClipboard`.
      if (mod && e.shiftKey && e.key === 'C') {
        e.preventDefault();
        if (ids.length) {
          copySelectionToPngClipboard(ids).catch((err: unknown) =>
            console.error('[clipboard] copy as PNG failed', err),
          );
        }
        return;
      }
      if (mod && e.key === 'c') {
        if (ids.length) {
          copyShapes(editor, ids);
          void writeShapesToOsClipboard(editor, ids, clipboardToken());
        }
        return;
      }
      if (mod && e.key === 'x') {
        if (ids.length) {
          copyShapes(editor, ids);
          void writeShapesToOsClipboard(editor, ids, clipboardToken());
          const cut = ids.filter((id) => !editor.getShape(id)?.locked);
          editor.deleteShapes(cut);
          useSelectionStore.getState().clear();
        }
        return;
      }

      // Zoom (anchored at the viewport center).
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'in'));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'out'));
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        useCameraStore.getState().zoomAtScreen(centerRef.current, 1);
        return;
      }

      // Arrow-key nudge (Shift = coarse). Skips locked shapes.
      if (
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown'
      ) {
        if (!ids.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        editor.transact(() => {
          for (const id of ids) {
            const s = editor.getShape(id);
            if (s && !s.locked) editor.updateShape(id, { x: s.x + dx, y: s.y + dy });
          }
        });
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        // Never delete locked shapes; deleting a container takes its children.
        const unlocked = ids.filter((id) => !editor.getShape(id)?.locked);
        const deletable = deleteTargetIds(editor.getShapes(), unlocked);
        if (deletable.length) {
          e.preventDefault();
          editor.deleteShapes(deletable);
          useSelectionStore.getState().clear();
        }
        return;
      }
      if (e.key === 'Enter' && ids.length === 1) {
        const shape = editor.getShape(ids[0]!);
        if (shape?.type === 'text' && !shape.locked) {
          e.preventDefault();
          useTextEditingStore
            .getState()
            .start(shape.id, {
              anchor: shape.props.text.length,
              head: shape.props.text.length,
            });
          return;
        }
        if (shape?.type === 'equation' && !shape.locked) {
          e.preventDefault();
          requestEquationFocus(shape.id);
          return;
        }
      }
      if (e.key === 'Escape') {
        useEnteredGroupStore.getState().exit();
        useSelectionStore.getState().clear();
        useToolStore.getState().setTool('select');
        return;
      }
      if (mod || e.altKey) return;
      // Shape Lock: toggle the lock on the current selection. Must precede the
      // hotkey lookup, since byHotkey('L') would otherwise match the Line tool.
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        if (ids.length) {
          const allLocked = ids.every((id) => editor.getShape(id)?.locked);
          editor.transact(() => {
            for (const id of ids) editor.updateShape(id, { locked: !allLocked });
          });
        }
        return;
      }
      // Tool Lock: keep the active creation tool after placing a shape.
      if (e.key === 'q' || e.key === 'Q') {
        e.preventDefault();
        useToolLockStore.getState().toggle();
        return;
      }
      const tool = toolRegistry.byHotkey(e.key);
      if (tool) {
        e.preventDefault();
        useToolStore.getState().setTool(tool.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta') return;
      toolRegistry
        .get(useToolStore.getState().activeToolId)
        ?.onKeyUp?.(e, ctx);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ctx]);

  // The single paste path (Cmd+V). Prefers our own tagged copy (editable
  // shapes), then a clipboard image, then the in-app buffer as a fallback.
  // All pastes land at the pointer (viewport center when off-canvas).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const dt = e.clipboardData;
      const ours =
        hasClipboard() && wbClipToken(dt?.getData('text/html') ?? '') === clipboardToken();

      const files: File[] = [];
      if (dt?.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]!;
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const f = item.getAsFile();
            if (f) files.push(f);
          }
        }
      }

      const world = screenToWorld(
        pointerRef.current ?? centerRef.current,
        useCameraStore.getState().camera,
      );
      const selectPasted = (ids: string[]) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      };

      if (ours) {
        e.preventDefault();
        selectPasted(pasteShapes(editor, world));
        return;
      }
      if (files.length) {
        e.preventDefault();
        void placeImageFiles(files, world).then(selectPasted);
        return;
      }
      const youtubeId = parseYoutubeId(dt?.getData('text/plain') ?? '');
      if (youtubeId) {
        e.preventDefault();
        selectPasted([createYoutubeShape(youtubeId, world)]);
        return;
      }
      if (hasClipboard()) {
        e.preventDefault();
        selectPasted(pasteShapes(editor, world));
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // Drag-and-drop files onto the canvas: images are placed at the drop point,
  // anything else goes to the board's document repository.
  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      const dropped = Array.from(e.dataTransfer.files);
      const images = dropped.filter((f) => f.type.startsWith('image/'));
      const documents = dropped.filter((f) => !f.type.startsWith('image/'));
      if (!images.length && !documents.length) return;
      e.preventDefault();

      if (documents.length) {
        addFilesToRepository(documents, getLocalUser()?.name ?? 'Someone');
        // Reveal the repository so the file doesn't seem to vanish.
        useDocumentsStore.getState().setPanelOpen(true);
      }
      if (!images.length) return;

      const rect = containerRef.current?.getBoundingClientRect();
      const world = screenToWorld(
        { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
        useCameraStore.getState().camera,
      );
      void placeImageFiles(images, world).then((ids) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      });
    },
    [containerRef],
  );

  // Zoom controls.
  const center = useCallback(
    () => ({ x: size.width / 2, y: size.height / 2 }),
    [size.width, size.height],
  );
  const onZoomIn = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.animateZoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'in'));
  }, [center]);
  const onZoomOut = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    s.animateZoomAtScreen(center(), nextDiscreteZoom(s.camera.z, 'out'));
  }, [center]);
  const onZoomReset = useCallback(() => {
    stopFollowingForManualCameraChange();
    useCameraStore.getState().animateZoomAtScreen(center(), 1);
  }, [center]);
  const onZoomToFit = useCallback(() => {
    stopFollowingForManualCameraChange();
    const s = useCameraStore.getState();
    const bounds = spatialIndex.totalBounds();
    if (!bounds) s.reset();
    else s.animateToBounds(bounds, size.width, size.height);
  }, [size.width, size.height]);
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
  const rotationCursor = useSelectionStore((state) => state.rotationCursor);
  const showDrawingCursor = activeToolId === 'draw' && !pan.isSpaceDown;
  const cursor = pan.isPanning || handDragging
    ? 'grabbing'
    : pan.isSpaceDown
      ? 'grab'
      : showDrawingCursor
        ? 'none'
        : rotationCursor ?? toolCursor;

  return (
    <div
      ref={containerRef}
      data-canvas-surface
      role="region"
      aria-label="Whiteboard canvas"
      aria-describedby="canvas-keyboard-help"
      tabIndex={0}
      className="absolute inset-0 overflow-hidden bg-surface"
      style={{ touchAction: 'none', cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onLostPointerCapture={onLostPointerCapture}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPointerEnter={(e) => publishCursorPosition(e.clientX, e.clientY)}
      onPointerLeave={(e) => {
        const rect = containerRef.current?.getBoundingClientRect();
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
        pointerRef.current = null;
      }}
    >
      <span id="canvas-keyboard-help" className="sr-only">
        Use the toolbars or single-key tool shortcuts to work on the board.
        Open Board actions, then Keyboard shortcuts, for the complete
        reference.
      </span>
      <CanvasSelectionStatus />
      <Background
        type={background}
        camera={camera}
        width={size.width}
        height={size.height}
      />

      <svg className="absolute inset-0 h-full w-full">
        <g transform={cameraToTransform(camera)}>
          {renderedShapes}
        </g>
      </svg>

      {/* While the camera moves, an invisible blocker captures pointer hit-tests
          so the browser doesn't walk the SVG shape tree every frame. Pointer and
          wheel events still bubble to the container's handlers below it. */}
      {cameraMoving && <div className="absolute inset-0" />}

      <PeerSelectionLayer camera={camera} />
      {!editingShape && <SelectionLayer camera={camera} />}
      {!editingShape && <SelectionToolbar camera={camera} />}
      <CursorsLayer camera={camera} viewportSize={size} />
      <LaserLayer camera={camera} />
      <CommentsLayer camera={camera} />
      {showDrawingCursor && (
        <DrawingCursor camera={camera} containerRef={containerRef} />
      )}

      {editingShape?.type === 'text' && (
        <TextEditorOverlay shape={editingShape} camera={camera} />
      )}

      {playingShape?.type === 'video' && (
        <VideoPlayerOverlay shape={playingShape} camera={camera} />
      )}

      {croppingShape?.type === 'image' && (
        <ImageCropOverlay shape={croppingShape} camera={camera} />
      )}

      <UndoControls
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />

      <CanvasControls
        zoom={camera.z}
        background={background}
        onBackgroundChange={setBackground}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onZoomReset={onZoomReset}
        onZoomToFit={onZoomToFit}
        equations={equationItems}
        onEquationSelect={onEquationSelect}
      />

      {debugPerformance && <PerformanceOverlay />}
    </div>
  );
}
