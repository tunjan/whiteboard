import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  DragEvent as ReactDragEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { type Shape, pointInPolygon } from '@whiteboard/shared';
import './shapes/register';
import './tools/register';
import { ActiveStrokeLayer } from './ActiveStrokeLayer';
import { hitTestCanvas } from './engine/hit-test';
import { FlatShapeLayer } from './FlatShapeLayer';
import { useBenchFlags } from './bench-flags';
import { Background } from './Background';
import { CanvasControls } from './CanvasControls';
import { Minimap } from './Minimap';
import { UndoControls } from './UndoControls';
import {
  type Camera,
  isActualSize,
  nextDiscreteZoom,
  screenToWorld,
  zoomCameraAtScreen,
} from './camera';
import { QuickZoomFrame } from './QuickZoomFrame';
import { isDoubleTap, oneFingerZoomFactor } from './one-finger-zoom';
import {
  quickZoomBounds,
  quickZoomFrameSize,
  quickZoomOverviewZoom,
} from './quick-zoom';
import { useEdgeScroll } from './use-edge-scroll';
import { viewportWorldBounds } from './geometry';
import { PerformanceOverlay } from '@/components/performance-overlay';
import { noteActivity } from '@/collab/attention';
import { CursorsLayer } from '@/collab/CursorsLayer';
import { PeerSelectionLayer } from '@/collab/PeerSelectionLayer';
import { CommentsLayer } from './CommentsLayer';
import { DrawingCursor } from './DrawingCursor';
import { LaserCursor } from './LaserCursor';
import { EraserTrail } from './EraserTrail';
import { LaserLayer } from './LaserLayer';
import {
  getLocalUser,
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
import { plotArea } from './shapes/graph';
import { panViewport, zoomViewport } from './shapes/graph-interaction';
import { HoverLayer } from './HoverLayer';
import { SelectionLayer } from './SelectionLayer';
import { SelectionToolbar } from './SelectionToolbar';
import { TextEditorOverlay } from './TextEditorOverlay';
import { FrameTitleEditorOverlay } from './FrameTitleEditorOverlay';
import { VideoPlayerOverlay } from './VideoPlayerOverlay';
import { ImageCropOverlay } from './ImageCropOverlay';
import { toolRegistry } from './tools/tool-registry';
import type { ToolContext, ToolPointerInfo } from './tools/types';
import {
  deleteShapesWithCleanup,
  duplicateShapes,
  groupShapes,
  ungroupShapes,
} from './commands';
import {
  clipboardToken,
  copyShapes,
  hasClipboard,
  pasteShapes,
  wbClipToken,
} from './clipboard';
import { copyStyle, pasteStyle } from './style-clipboard';
import { writeShapesToOsClipboard } from '@/board/clipboard-os';
import { addFilesToRepository } from '@/board/documents';
import { useDocumentsStore } from './use-documents-store';
import { flipShapes } from './flip';
import { deleteTargetIds, moveTargetIds } from './hierarchy';
import { linkUrlsFromClipboard } from './link-url';
import { placeImageFiles } from './place-image';
import { placeLinkUrls } from './place-link';
import { PDF_MIME, placePdfFiles } from './place-pdf';
import { createYoutubeShape, parseYoutubeId } from './place-video';
import { useEnteredGroupStore } from './use-entered-group-store';
import {
  bindingGraph,
  breakUndoCapture,
  editor,
  redo,
  setCurrentPage,
  setCurrentPageForFollow,
  spatialIndex,
  takeBindingDirty,
  undo,
  useDocumentStore,
  useUndoStore,
} from './use-document-store';
import { syncBoundArrows } from './shapes/connector-routing';
import { useCameraStore } from './use-camera-store';
import { subscribeCanvasZoomToBounds } from './camera-requests';
import { useCameraInteraction } from './use-camera-interaction';
import { useCanvasUiStore } from './use-canvas-ui-store';
import {
  getContainerRect,
  invalidateContainerRect,
  useContainerRect,
} from './container-rect';
import { useElementSize } from './use-element-size';
import { useSafariGestures } from './use-safari-gestures';
import { copySelectionToPngClipboard } from './export-png';
import { getSelectionInfo } from './selection-geometry';
import { shapeRotatedBounds } from './shape-bounds';
import { isSelectable } from './selectable';
import { useHiddenStore } from './use-hidden-store';
import { clearHover, updateHoverAt } from './use-hover-store';
import { useLiveStrokeShapeId } from './use-live-stroke-store';
import { useSelectionStore } from './use-selection-store';
import {
  MIDDLE_BUTTON,
  RIGHT_BUTTON,
  exceedsRightDragThreshold,
  useSpacePan,
} from './use-space-pan';
import { springReturnTool, type SpringHold } from './spring-tool';
import { useTextEditingStore } from './use-text-editing-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { requestEquationFocus } from './equation-focus';
import { useVideoPlayingStore } from './use-video-playing-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useToolStore } from './use-tool-store';
import {
  fingerDraws,
  isFingerTap,
  multiTouchTapAction,
} from './touch-input';
import { useToolLockStore } from './use-tool-lock-store';
import {
  TOUCH_PAN_SPEED,
  nextPinchMode,
  pinchGesture,
  pinchReleaseZoomRate,
  pruneStaleTouches,
  trackPinchZoom,
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
/**
 * The lean of a stylus barrel as a vector on the page, with a magnitude of 1
 * for a pen laid flat.
 *
 * `tiltX`/`tiltY` are read first because every browser that reports tilt at
 * all reports those, and they are already the two components the ink engine
 * wants — normalizing off their ±90° range is the whole conversion. Safari and
 * recent Chrome also expose the spherical form; it is the fallback rather than
 * the primary because a device reporting only `altitudeAngle` is rarer than
 * one reporting only tilt, and mixing the two per-sample would let a stroke
 * change nib model halfway through.
 *
 * `altitudeAngle` is measured up from the page, so a pen held upright is π/2
 * and its cosine — the lean — is 0.
 */
const ZERO_TILT = { x: 0, y: 0 };
const TILT_DEGREES = 90;

function readTilt(e: object): { x: number; y: number } {
  const pen = e as Partial<
    Record<'tiltX' | 'tiltY' | 'altitudeAngle' | 'azimuthAngle', number>
  >;
  const tiltX = Number.isFinite(pen.tiltX) ? pen.tiltX! : 0;
  const tiltY = Number.isFinite(pen.tiltY) ? pen.tiltY! : 0;
  if (tiltX !== 0 || tiltY !== 0) {
    return { x: tiltX / TILT_DEGREES, y: tiltY / TILT_DEGREES };
  }
  const altitude = pen.altitudeAngle;
  const azimuth = pen.azimuthAngle;
  if (!Number.isFinite(altitude) || !Number.isFinite(azimuth)) return ZERO_TILT;
  const lean = Math.cos(altitude!);
  if (!(lean > 0)) return ZERO_TILT;
  return { x: Math.cos(azimuth!) * lean, y: Math.sin(azimuth!) * lean };
}

const STALE_TOUCH_MS = 2000;

/**
 * Tools under which a double-tap-and-drag is free to mean "zoom". Under the
 * stroke tools that same gesture is two dots and a line, and this would eat it.
 */
const ONE_FINGER_ZOOM_TOOLS = new Set(['select', 'hand']);

/**
 * How long a tool hotkey must be held for the press to read as a hold rather
 * than a tap, when the hand did nothing with the tool it borrowed.
 *
 * Only the empty-handed case needs a clock at all: pressing a key and using
 * the tool is a hold however briefly the key was down. This covers the press
 * that borrows a tool, thinks better of it, and lets go — long enough not to
 * catch an ordinary deliberate tap, short enough that a hand which paused
 * before drawing still gets its previous tool back.
 */
const SPRING_HOLD_MS = 250;

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
  const camera = useCameraStore((s) => s.camera);
  const following = useFollowStore((s) => s.following);
  const lastSummonApplied = useFollowStore((s) => s.lastSummonApplied);
  const background = useCanvasUiStore((s) => s.background);
  const setBackground = useCanvasUiStore((s) => s.setBackground);
  const minimapVisible = useCanvasUiStore((s) => s.minimapVisible);
  const setMinimapVisible = useCanvasUiStore((s) => s.setMinimapVisible);
  const debugPerformance = useCanvasUiStore((s) => s.debugPerformance);
  const activeToolId = useToolStore((s) => s.activeToolId);
  const cameraMoving = useCameraInteraction((s) => s.isMoving);
  // TEMPORARY perf harness — delete with ./zoom-bench.ts.
  const bench = useBenchFlags();
  const handDragging = useCameraInteraction((s) => s.isHandDragging);
  const pan = useSpacePan(false);
  useWheel(containerRef, false);
  useSafariGestures(containerRef, false);

  // Which gesture owns the current pointer interaction.
  const gesture = useRef<'pan' | 'tool' | 'zoom' | null>(null);
  // The pointer currently driving `gesture` (so stray pointers are ignored).
  const toolPointerId = useRef<number | null>(null);
  // A tool hotkey currently held down, and the tool it borrowed from. Null when
  // the last hotkey was a tap, or when the borrowed tool has been given back.
  // See `releaseSpring`.
  const spring = useRef<SpringHold | null>(null);
  // Tool to return to once the current gesture ends, set when the hotkey came
  // up while the hand was still drawing. See `finishSpring`.
  const springReturn = useRef<string | null>(null);
  // Live touch pointers on the surface, id → last-seen position (container px) and
  // timestamp. Drives single- vs multi-touch routing and the pinch math. iOS
  // routinely drops pointerup/cancel when the OS steals a gesture, so entries are
  // pruned by `reconcileStaleTouches` rather than trusted to clear themselves.
  const activeTouches = useRef<
    Map<number, { x: number; y: number; t: number }>
  >(new Map());
  // Where and when a finger-pan press started, while one is in flight. A press
  // that pans nowhere is replayed to the active tool as a tap on release, so a
  // finger that navigates can still point at things.
  const fingerTap = useRef<{ x: number; y: number; t: number } | null>(null);
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
  // The multi-finger gesture in flight, for the tap that means undo/redo: when
  // it started, the most fingers it ever carried, and whether it moved the
  // board. Resolved when the last finger lifts.
  const multiTouch = useRef<{
    t: number;
    fingers: number;
    moved: boolean;
  } | null>(null);
  // Latched once ≥2 fingers touch, cleared only when all lift — suppresses tool
  // routing for the rest of a pinch so lifting one finger never draws a stray mark.
  const pinchLatch = useRef(false);
  // A right-button press that has not yet decided between opening the context
  // menu and panning the board.
  const rightPointer = useRef<{
    id: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null>(null);
  // Whether the next `contextmenu` belongs to a right press this handler has
  // already dealt with, and must not reach the menu.
  const swallowContextMenu = useRef(false);
  // Set while dispatching our own `contextmenu`, which must not be swallowed.
  const replayingContextMenu = useRef(false);
  // Long-press → context menu (touch has no right-click).
  const longPressTimer = useRef<number | null>(null);
  const longPressOrigin = useRef<{ x: number; y: number } | null>(null);
  // Live viewport center (screen px), read by keyboard zoom shortcuts.
  const centerRef = useRef({ x: 0, y: 0 });
  centerRef.current = { x: size.width / 2, y: size.height / 2 };
  // Last pointer position in container pixels; paste lands here (null = off-canvas).
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  // The last pointer info handed to the active tool, replayed when edge
  // scrolling moves the world out from under a stationary pointer.
  const lastToolInfo = useRef<ToolPointerInfo | null>(null);
  // A finger's previous tap, for double-tap-and-drag zoom detection.
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null);
  // The live one-finger zoom: where it started and the camera it started from.
  const oneFingerZoom = useRef<{
    anchor: { x: number; y: number };
    camera: Camera;
  } | null>(null);
  // Quick Zoom: `Z` is held (armed), and the pressed gesture's state.
  const quickZoomArmed = useRef(false);
  const quickZoom = useRef<{ returnZoom: number; overviewZoom: number } | null>(
    null,
  );
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
  const hasEquations = useDocumentStore((s) => s.hasEquations);
  const hidden = useHiddenStore((s) => s.hidden);
  const currentPageId = useDocumentStore((s) => s.currentPageId);
  const shapesById = useDocumentStore((s) => s.shapesById);
  // Shared, pre-sorted array from the store (stable across camera-only renders).
  const shapes = useDocumentStore((s) => s.shapes);
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
      shapesById,
    );
  }, [shapes, shapesById]);
  const equationItems = useMemo(
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
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);

  const editingShape = editingId ? shapesById.get(editingId) : undefined;
  const frameEditingShape = frameEditingId
    ? shapesById.get(frameEditingId)
    : undefined;
  const playingShape = playingId ? shapesById.get(playingId) : undefined;
  const croppingShape = croppingId ? shapesById.get(croppingId) : undefined;
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

  const toInfo = useCallback(
    (
      e: ReactPointerEvent | ReactMouseEvent | PointerEvent,
      // Optional pre-read container rect. `getContainerRect` serves a cache
      // (see `container-rect.ts`), so this is now a lookup rather than the
      // forced reflow it used to be; callers processing many coalesced samples
      // per event still pass their rect in to skip even that.
      rect?: DOMRect,
    ): ToolPointerInfo => {
      const r = rect ?? getContainerRect(containerRef.current);
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
      const tilt = pointerType === 'pen' ? readTilt(e) : ZERO_TILT;
      return {
        point: screenToWorld(screen, camera),
        screenPoint: screen,
        timestamp: e.timeStamp,
        zoom: camera.z,
        pressure,
        tiltX: tilt.x,
        tiltY: tilt.y,
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

  const activeTool = () =>
    toolRegistry.get(useToolStore.getState().activeToolId);

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

  /**
   * Let go of a tool that a held hotkey borrowed.
   *
   * Tapping a tool key is a mode switch and stays; holding one is a moment's
   * use of another tool, and the moment ends with the key. What separates them
   * is whether the hand did anything with the borrowed tool — drew, erased,
   * dragged a selection — or held the key long enough that nothing else was
   * meant by it. Without that distinction every hotkey press would be
   * provisional until the key came back up.
   *
   * Reverting is skipped when the active tool is no longer the borrowed one:
   * the toolbar, Escape, or a creation tool completing have already moved on,
   * and there is nothing left to give back.
   */
  const releaseSpring = useCallback((e: KeyboardEvent) => {
    const held = spring.current;
    if (!held || held.key !== e.key.toLowerCase()) return;
    spring.current = null;
    const to = springReturnTool(
      held,
      e,
      useToolStore.getState().activeToolId,
      SPRING_HOLD_MS,
    );
    if (to === null) return;
    // The key came up before the hand did. Finishing the stroke matters more
    // than the exact instant the tool reverts, so the switch waits for the
    // gesture rather than cutting it off halfway.
    if (gesture.current === 'tool') {
      springReturn.current = to;
      return;
    }
    useToolStore.getState().setTool(to);
  }, []);

  /** Complete a revert that was deferred until the gesture in flight ended. */
  const finishSpring = useCallback(() => {
    const to = springReturn.current;
    if (to === null) return;
    springReturn.current = null;
    useToolStore.getState().setTool(to);
  }, []);

  // End the active tool/pan gesture, either committing it (the pointer lifted
  // normally) or cancelling it (a pinch/pen stole the interaction).
  // Re-deliver the last pointer position to the active tool after the camera
  // has moved under it. The pointer is stationary on screen but the world point
  // beneath it is not, and a drag in flight is defined in world coordinates —
  // without this, edge scrolling would slide the board out from under the very
  // shape being dragged to the edge.
  const dispatchSyntheticMove = useCallback(() => {
    const previous = lastToolInfo.current;
    if (!previous || gesture.current !== 'tool') return;
    const camera = useCameraStore.getState().camera;
    const point = screenToWorld(previous.screenPoint, camera);
    if (point.x === previous.point.x && point.y === previous.point.y && camera.z === previous.zoom) return;
    const info: ToolPointerInfo = {
      ...previous,
      point,
      isCameraMove: true,
      zoom: camera.z,
      timestamp: performance.now(),
      // Predictions describe where the hardware was heading; a camera move is
      // not pointer motion and must not replay them.
      predicted: undefined,
    };
    lastToolInfo.current = info;
    activeTool()?.onPointerMove?.(info, ctx);
  }, [ctx]);

  useEffect(() => useCameraStore.subscribe((next, prev) => {
    if (next.camera === prev.camera || next.activeKey !== prev.activeKey) return;
    const screen = pointerRef.current;
    if (screen) setLocalCursor(screenToWorld(screen, next.camera));
    dispatchSyntheticMove();
  }), [dispatchSyntheticMove]);

  const edgeScroll = useEdgeScroll({
    getViewportSize: () => sizeRef.current,
    onScroll: dispatchSyntheticMove,
  });

  const endToolGesture = useCallback(
    (target: Element, mode: 'commit' | 'cancel') => {
      const id = toolPointerId.current;
      edgeScroll.stop();
      lastToolInfo.current = null;
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
      if (wasToolGesture) finishSpring();
    },
    [ctx, finishSpring, edgeScroll],
  );

  const startToolGesture = useCallback(
    (e: ReactPointerEvent) => {
      // Make every new gesture an undo boundary as a fallback for browsers
      // that drop a preceding pointer-up/cancel event.
      breakUndoCapture();
      // Using a tool is what makes a held hotkey a hold rather than a tap, so
      // the gesture is what the spring springs back from.
      if (spring.current) spring.current.used = true;
      gesture.current = 'tool';
      toolPointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      const info = toInfo(e);
      lastToolInfo.current = info;
      activeTool()?.onPointerDown?.(info, ctx);
    },
    [toInfo, ctx],
  );


  // A pointer position in container (canvas-relative) pixels.
  const screenPointOf = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const rect = getContainerRect(containerRef.current);
      return {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
    },
    [containerRef],
  );

  // Publish immediately when the pointer enters or presses the board, not just
  // after it moves. This keeps a peer marker visible for clicks and taps too.
  const publishCursorPosition = useCallback(
    (clientX: number, clientY: number, rect?: DOMRect) => {
      const r = rect ?? getContainerRect(containerRef.current);
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
      noteActivity();
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
      startMidpoint: g.midpoint,
      lastMidpoint: g.midpoint,
      mode: 'unsure',
      zoomRate: 0,
      lastZoom: useCameraStore.getState().camera.z,
      lastZoomTime: performance.now(),
    };
    pinchLastDistance.current = g.distance;
    // If the pinch lands inside the sole selected graph's plot, it adjusts that
    // graph's viewport; otherwise it's a normal board pinch.
    pinchGraphId.current = graphAtScreenPoint(g.midpoint);
    if (!pinchGraphId.current) stopFollowingForManualCameraChange();
  }, [graphAtScreenPoint]);

  // Quick Zoom: pull back far enough to see the whole board, frame somewhere
  // with the pointer, release to fly there.
  const beginQuickZoom = useCallback(
    (e: ReactPointerEvent): boolean => {
      const { width, height } = sizeRef.current;
      if (width <= 0 || height <= 0) return false;
      const point = screenPointOf(e);
      const store = useCameraStore.getState();
      const camera = store.camera;
      const overviewZoom = quickZoomOverviewZoom(
        camera,
        point,
        width,
        height,
        quickZoomBounds(
          viewportWorldBounds(camera, width, height),
          spatialIndex.totalBounds(),
        ),
      );
      stopFollowingForManualCameraChange();
      quickZoom.current = { returnZoom: camera.z, overviewZoom };
      gesture.current = 'zoom';
      toolPointerId.current = e.pointerId;
      e.currentTarget.setPointerCapture(e.pointerId);
      store.setCamera(zoomCameraAtScreen(camera, point, overviewZoom));
      setQuickZoomFrame({
        center: point,
        ...quickZoomFrameSize(overviewZoom, camera.z, width, height),
      });
      return true;
    },
    [screenPointOf],
  );

  // Drop out of Quick Zoom, optionally landing on the framed region.
  const endQuickZoom = useCallback(
    (point: { x: number; y: number } | null) => {
      const active = quickZoom.current;
      quickZoom.current = null;
      setQuickZoomFrame(null);
      if (!active) return;
      if (point) {
        useCameraStore.getState().animateZoomAtScreen(point, active.returnZoom);
      }
    },
    [],
  );

  /**
   * Drop whatever gesture a finger owns, because something else has taken the
   * interaction over — a second finger arriving, or a long press turning into
   * a context menu.
   *
   * A tool stroke and a finger pan both end here because both are things one
   * finger can be doing, and the callers cannot know which: with
   * `fingerAction: 'pan'` the very same press that used to start a stroke
   * starts a pan instead. Ending a pan through `endToolGesture` would leave
   * `useSpacePan` believing a drag was still in flight.
   */
  const abandonGesture = useCallback(
    (target: Element) => {
      if (gesture.current !== 'pan') {
        endToolGesture(target, 'cancel');
        return;
      }
      const id = toolPointerId.current;
      fingerTap.current = null;
      pan.cancel();
      if (id !== null && target.hasPointerCapture(id)) {
        target.releasePointerCapture(id);
      }
      gesture.current = null;
      toolPointerId.current = null;
      edgeScroll.stop();
    },
    [endToolGesture, pan, edgeScroll],
  );

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
          fingerTap.current = null;
          pan.cancel();
          if (
            target &&
            pointerId !== null &&
            target.hasPointerCapture(pointerId)
          ) {
            target.releasePointerCapture(pointerId);
          }
        }
        if (gesture.current === 'zoom') {
          gesture.current = null;
          toolPointerId.current = null;
        }
        oneFingerZoom.current = null;
        lastTap.current = null;
        endQuickZoom(null);
        edgeScroll.stop();
        if (pinchGraphId.current) breakUndoCapture();
        activeTouches.current.clear();
        pinch.current = null;
        pinchGraphId.current = null;
        pinchLatch.current = false;
        multiTouch.current = null;
        penActive.current = false;
        pointerRef.current = null;
      }),
    [clearLongPress, containerRef, endToolGesture, pan, endQuickZoom, edgeScroll],
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
        abandonGesture(target);
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
    [abandonGesture],
  );

  /**
   * Open the context menu for a right press that turned out not to be a pan.
   *
   * A right press cannot mean "menu" until the pointer lifts — until then it
   * might be a drag — so the `contextmenu` the browser fires for the press is
   * swallowed and this dispatches one in its place at the release point. Same
   * mechanism as the touch long-press above, and the same reason: it opens the
   * menu through the path that already exists rather than a second one.
   */
  const replayContextMenu = useCallback((e: ReactPointerEvent) => {
    const target =
      document.elementFromPoint(e.clientX, e.clientY) ?? e.currentTarget;
    replayingContextMenu.current = true;
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        button: RIGHT_BUTTON,
        view: window,
      }),
    );
    replayingContextMenu.current = false;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      // One measurement per gesture, so a rectangle that went stale for a
      // reason the invalidation listeners don't cover cannot mislocate a whole
      // stroke — only the moment before the hand landed.
      useCameraStore.getState().stopCameraAnimation();
      invalidateContainerRect();
      publishCursorPosition(e.clientX, e.clientY);
      // The hover outline promises what a click would catch; once the click has
      // happened the selection box says it instead.
      clearHover();
      // A right press released somewhere this element never saw would otherwise
      // leave the next context menu swallowed.
      rightPointer.current = null;
      swallowContextMenu.current = false;

      // Touch: one finger either drives the active tool or pans the board (see
      // `fingerAction`); two fingers are always a pinch/pan.
      if (isTouchPointer(e)) {
        reconcileStaleTouches(e.timeStamp);
        if (penActive.current) return; // palm rejection while the pen is down
        activeTouches.current.set(e.pointerId, {
          ...screenPointOf(e),
          t: e.timeStamp,
        });
        if (activeTouches.current.size >= 2) {
          // Second finger down → a pinch is starting: abort the one-finger
          // gesture (the pinch branch in onPointerMove owns the camera now)
          // and mute tool routing.
          pinchLatch.current = true;
          clearLongPress();
          abandonGesture(e.currentTarget);
          // Only fingers on the board itself: two of them on a panel are a
          // scroll or a stray rest, not a command aimed at the document.
          if (isSurfaceEvent(e.target)) {
            const tap = multiTouch.current;
            multiTouch.current = tap
              ? {
                  ...tap,
                  fingers: Math.max(tap.fingers, activeTouches.current.size),
                }
              : {
                  t: e.timeStamp,
                  fingers: activeTouches.current.size,
                  moved: false,
                };
          }
          beginPinch();
          return;
        }
        if (pinchLatch.current) return; // mid-pinch: wait until all fingers lift
        if (!isSurfaceEvent(e.target)) return;
        const ui = useCanvasUiStore.getState();
        const drives = fingerDraws(ui.fingerAction, ui.penSeen);
        // Double-tap and hold, then drag, to zoom with one finger. Under the
        // stroke tools that same gesture is two dots and a line, so it is
        // offered only where nothing is being accumulated — which, once the
        // finger no longer draws at all, is everywhere.
        const point = screenPointOf(e);
        if (
          (!drives ||
            ONE_FINGER_ZOOM_TOOLS.has(useToolStore.getState().activeToolId)) &&
          isDoubleTap(lastTap.current, point, e.timeStamp)
        ) {
          lastTap.current = null;
          stopFollowingForManualCameraChange();
          oneFingerZoom.current = {
            anchor: point,
            camera: { ...useCameraStore.getState().camera },
          };
          gesture.current = 'zoom';
          toolPointerId.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          return;
        }
        lastTap.current = { ...point, t: e.timeStamp };
        if (!drives) {
          // The finger moves the board instead. Same drag machinery the middle
          // button and Space use, so it inherits the release coast.
          stopFollowingForManualCameraChange();
          gesture.current = 'pan';
          toolPointerId.current = e.pointerId;
          fingerTap.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
          pan.beginPan(e);
          armLongPress(e);
          return;
        }
        startToolGesture(e);
        // A held eraser is still an erase gesture. Other touch tools keep the
        // long-press context menu, but cancelling an eraser after 500ms would
        // undo the exact sustained gesture this tool is meant to support.
        if (useToolStore.getState().activeToolId !== 'eraser') armLongPress(e);
        return;
      }

      // Mouse / pen.
      if (!isSurfaceEvent(e.target)) return;
      if (e.pointerType === 'pen') {
        penActive.current = true;
        penLastSeen.current = e.timeStamp;
        // The one fact `fingerAction: 'auto'` turns on: a stylus exists here.
        useCanvasUiStore.getState().notePenSeen();
        // A resting finger may have started a stray stroke first — discard it.
        // But a *pen*-started gesture still active here means the previous
        // stroke's pointerup/lostpointercapture was dropped (common on Wacom
        // tablets, which bump the pointerId each stroke); commit that finished
        // stroke, don't delete it.
        if (
          gesture.current === 'tool' &&
          toolPointerId.current !== e.pointerId
        ) {
          const priorWasTouch =
            toolPointerId.current !== null &&
            activeTouches.current.has(toolPointerId.current);
          endToolGesture(e.currentTarget, priorWasTouch ? 'cancel' : 'commit');
        }
      }
      // Quick Zoom takes the press before any tool sees it: `Z` is held, so
      // this press is aiming the camera, not using the tool.
      if (quickZoomArmed.current && beginQuickZoom(e)) return;
      // Right-drag pans too, but only once the press has travelled: until then
      // it is still a context menu, which `onPointerUp` opens on release.
      if (e.button === RIGHT_BUTTON) {
        rightPointer.current = {
          id: e.pointerId,
          x: e.clientX,
          y: e.clientY,
          dragged: false,
        };
        return;
      }
      // Middle-drag pans regardless of the active tool or any key held — the
      // one pan gesture that costs nothing to reach mid-drawing.
      if (pan.isSpaceDown || e.button === MIDDLE_BUTTON) {
        // Without this the browser opens its own autoscroll widget on top.
        if (e.button === MIDDLE_BUTTON) e.preventDefault();
        stopFollowingForManualCameraChange();
        gesture.current = 'pan';
        toolPointerId.current = e.pointerId;
        pan.beginPan(e);
        return;
      }
      startToolGesture(e);
    },
    [
      pan,
      isSurfaceEvent,
      abandonGesture,
      endToolGesture,
      startToolGesture,
      armLongPress,
      clearLongPress,
      reconcileStaleTouches,
      screenPointOf,
      beginPinch,
      beginQuickZoom,
      publishCursorPosition,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent) => {
      if (isTouchPointer(e) && penActive.current) return;
      const rect = getContainerRect(containerRef.current);
      if (rect) {
        pointerRef.current = {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }
      // Skip the presence cursor while pinching (two fingers, jittery midpoint).
      if (rect && !(isTouchPointer(e) && pinchLatch.current)) {
        publishCursorPosition(e.clientX, e.clientY, rect);
      }
      // What a click would select, outlined. Only while the select tool is idle:
      // a pointer already in a gesture is committed to it, and no other tool
      // acts on whatever happens to be underneath. Space-panning holds no
      // button, so the gesture is checked as well as the buttons.
      if (
        rect &&
        e.buttons === 0 &&
        gesture.current === null &&
        e.pointerType !== 'touch' &&
        useToolStore.getState().activeToolId === 'select'
      ) {
        updateHoverAt(
          screenToWorld(
            { x: e.clientX - rect.left, y: e.clientY - rect.top },
            useCameraStore.getState().camera,
          ),
        );
      }
      // A real drag past the slop cancels the pending long-press.
      if (longPressOrigin.current) {
        const dx = e.clientX - longPressOrigin.current.x;
        const dy = e.clientY - longPressOrigin.current.y;
        if (Math.hypot(dx, dy) > 10) clearLongPress();
      }
      if (e.pointerType === 'pen') penLastSeen.current = e.timeStamp;
      // Past the click slop, the right press was a drag: hand it to the same pan
      // machinery the middle button and Space use.
      const right = rightPointer.current;
      if (
        right &&
        e.pointerId === right.id &&
        !right.dragged &&
        exceedsRightDragThreshold(e.clientX - right.x, e.clientY - right.y)
      ) {
        right.dragged = true;
        stopFollowingForManualCameraChange();
        gesture.current = 'pan';
        toolPointerId.current = e.pointerId;
        pan.beginPan(e);
      }
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
            if (multiTouch.current) multiTouch.current.moved = true;
            return;
          }
          // Two fingers can mean either a pan or a zoom, and committing to one
          // keeps a gesture that was meant as a drag from also re-scaling the
          // board (which would re-cut the cull region on every frame).
          const mode = nextPinchMode(
            pinch.current.mode,
            { distance: pinch.current.startDistance, midpoint: pinch.current.startMidpoint },
            g,
          );
          if (mode === 'zooming' && pinch.current.mode !== 'zooming') {
            // Re-baseline on the transition: the fingers already crossed the
            // threshold, and scaling from the original separation would jump.
            pinch.current.startDistance = g.distance;
            pinch.current.startZoom = useCameraStore.getState().camera.z;
          }
          pinch.current.mode = mode;
          if (mode !== 'unsure' && multiTouch.current) {
            multiTouch.current.moved = true;
          }
          if (mode !== 'unsure') {
            useCameraStore
              .getState()
              .zoomAtScreenWithPan(
                g.midpoint,
                mode === 'panning'
                  ? pinch.current.startZoom
                  : zoomFromDistance(
                      pinch.current.startZoom,
                      pinch.current.startDistance,
                      g.distance,
                    ),
                (g.midpoint.x - pinch.current.lastMidpoint.x) * TOUCH_PAN_SPEED,
                (g.midpoint.y - pinch.current.lastMidpoint.y) * TOUCH_PAN_SPEED,
              );
            // Measured off the camera rather than off the finger separation, so
            // the rate handed to the release coast is the one the board was
            // actually moving at — zero once a spread has run into the zoom
            // limits, however fast the fingers were still going.
            trackPinchZoom(
              pinch.current,
              useCameraStore.getState().camera.z,
              e.timeStamp,
            );
          }
          // Tracked even while undecided so the deadband discards that motion
          // instead of releasing it as one jump when the mode resolves.
          pinch.current.lastMidpoint = g.midpoint;
          return;
        }
      }
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'zoom') {
        const point = { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) };
        const zooming = oneFingerZoom.current;
        if (zooming) {
          // Drag down to zoom in, up to zoom out, about where the second tap
          // landed. Measured from the gesture's own start camera, so the whole
          // drag is one absolute mapping rather than an accumulation that
          // drifts.
          useCameraStore
            .getState()
            .setCamera(
              zoomCameraAtScreen(
                zooming.camera,
                zooming.anchor,
                zooming.camera.z * oneFingerZoomFactor(point.y - zooming.anchor.y),
              ),
            );
        } else if (quickZoom.current) {
          const { overviewZoom, returnZoom } = quickZoom.current;
          setQuickZoomFrame({
            center: point,
            ...quickZoomFrameSize(
              overviewZoom,
              returnZoom,
              sizeRef.current.width,
              sizeRef.current.height,
            ),
          });
        }
        return;
      }
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
          ? (e.nativeEvent.getCoalescedEvents?.() ?? [])
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
        lastToolInfo.current = info;
        tool.onPointerMove(info, ctx);
        // Held against an edge, the drag keeps going by moving the board
        // instead — but not for the hand tool, which *is* the board moving.
        if (tool.id === 'hand') edgeScroll.stop();
        else edgeScroll.track(info.screenPoint);
      }
    },
    [
      pan,
      toInfo,
      ctx,
      containerRef,
      clearLongPress,
      publishCursorPosition,
      edgeScroll,
    ],
  );

  // Forget a pointer that is no longer on the glass. Called from every path a
  // touch/pen can end through — pointerup, pointercancel, and lostpointercapture
  // — so it must stay idempotent.
  const releaseTouchTracking = useCallback((e: ReactPointerEvent) => {
    if (e.pointerType === 'pen') penActive.current = false;
    if (!isTouchPointer(e)) return;
    activeTouches.current.delete(e.pointerId);
    if (activeTouches.current.size < 2) {
      pinch.current = null;
      if (pinchGraphId.current) {
        // End the capture window so the whole pinch is one undo step.
        breakUndoCapture();
        pinchGraphId.current = null;
      }
    }
    if (activeTouches.current.size === 0) {
      pinchLatch.current = false;
      // Resolved on the way out rather than on the way in: whether fingers that
      // went down together were a command or the start of a pinch is only
      // settled by what they did before lifting.
      const tap = multiTouch.current;
      multiTouch.current = null;
      if (tap) {
        const action = multiTouchTapAction(
          tap.fingers,
          e.timeStamp - tap.t,
          tap.moved,
        );
        if (action === 'undo') undo();
        else if (action === 'redo') redo();
      }
    }
  }, []);

  const releaseTouch = useCallback(
    (e: ReactPointerEvent) => {
      clearLongPress();
      releaseTouchTracking(e);
    },
    [clearLongPress, releaseTouchTracking],
  );

  /** Close out a Quick Zoom / one-finger zoom gesture. */
  const endZoomGesture = useCallback(
    (e: ReactPointerEvent, land: boolean) => {
      oneFingerZoom.current = null;
      endQuickZoom(land ? screenPointOf(e) : null);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      gesture.current = null;
      toolPointerId.current = null;
    },
    [endQuickZoom, screenPointOf],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent) => {
      // Fingers leaving mid-spread keep the scale moving, the way a released
      // pan keeps travelling. Read before `releaseTouch`, which tears the pinch
      // down; `size === 2` is this finger plus the one still on the glass.
      if (
        isTouchPointer(e) &&
        pinch.current &&
        !pinchGraphId.current &&
        activeTouches.current.size === 2
      ) {
        const zoomRate = pinchReleaseZoomRate(pinch.current, e.timeStamp);
        if (zoomRate !== 0) {
          useCameraStore.getState().slideCamera({ x: 0, y: 0 }, zoomRate);
        }
      }
      const right = rightPointer.current;
      if (right && e.pointerId === right.id) {
        rightPointer.current = null;
        // Platforms disagree about whether `contextmenu` rides the press or the
        // release, so swallow either way and let the replay open the menu.
        swallowContextMenu.current = true;
        if (!right.dragged) replayContextMenu(e);
      }
      releaseTouch(e);
      edgeScroll.stop();
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'zoom') {
        endZoomGesture(e, true);
        return;
      }
      if (gesture.current === 'pan') {
        const started = fingerTap.current;
        fingerTap.current = null;
        if (
          started &&
          isFingerTap(started, { x: e.clientX, y: e.clientY, t: e.timeStamp })
        ) {
          // The press panned nowhere, so it was a point rather than a drag:
          // the tool sees an ordinary click and select, comment and sticker
          // all work from a finger that otherwise only moves the board.
          // Replayed before the release below, which would otherwise hand the
          // camera whatever velocity the lift shook out of a stationary press.
          const tool = activeTool();
          const info = toInfo(e);
          tool?.onPointerDown?.(info, ctx);
          tool?.onPointerUp?.(info, ctx);
          breakUndoCapture();
        }
        pan.onPointerUp(e);
      }
      const wasToolGesture = gesture.current === 'tool';
      if (wasToolGesture) {
        activeTool()?.onPointerUp?.(toInfo(e), ctx);
        breakUndoCapture();
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }
      gesture.current = null;
      toolPointerId.current = null;
      // After the gesture is closed out, so the tool this hands back to enters
      // with nothing in flight.
      if (wasToolGesture) finishSpring();
    },
    [
      pan,
      toInfo,
      ctx,
      releaseTouch,
      finishSpring,
      edgeScroll,
      endZoomGesture,
      replayContextMenu,
    ],
  );

  // The browser fires pointercancel when it steals a touch (e.g. a pinch is
  // recognized) — abort the in-progress gesture rather than committing it.
  const onPointerCancel = useCallback(
    (e: ReactPointerEvent) => {
      if (rightPointer.current?.id === e.pointerId) rightPointer.current = null;
      releaseTouch(e);
      edgeScroll.stop();
      if (e.pointerId !== toolPointerId.current) return;
      if (gesture.current === 'zoom') {
        // A cancelled framing gesture leaves the camera where it is rather than
        // flying somewhere the user did not choose.
        endZoomGesture(e, false);
        return;
      }
      if (gesture.current === 'pan') {
        pan.onPointerUp(e);
        fingerTap.current = null;
        gesture.current = null;
        toolPointerId.current = null;
      } else {
        // A pen/mouse cancel is almost always a spurious OS event, not a real
        // gesture takeover — keep the in-progress stroke/drag. Touch keeps
        // discarding (a genuine pinch is interrupting a one-finger gesture).
        endToolGesture(
          e.currentTarget,
          isTouchPointer(e) ? 'cancel' : 'commit',
        );
      }
    },
    [pan, releaseTouch, endToolGesture, edgeScroll, endZoomGesture],
  );

  // Capture being lost (the OS reclaiming the pointer) is a second signal that a
  // touch/pen has gone, in case its pointerup/cancel was dropped. Cleaning up here
  // too keeps the latch from outliving the gesture.
  const onLostPointerCapture = useCallback(
    (e: ReactPointerEvent) => {
      if (rightPointer.current?.id === e.pointerId) rightPointer.current = null;
      releaseTouchTracking(e);
      edgeScroll.stop();
      if (e.pointerId === toolPointerId.current && gesture.current === 'zoom') {
        endZoomGesture(e, false);
        return;
      }
      if (e.pointerId === toolPointerId.current) {
        // Same rationale as onPointerCancel: a pen/mouse losing capture is a
        // spurious OS event, so keep the stroke/drag; touch still discards.
        if (gesture.current === 'tool') {
          endToolGesture(
            e.currentTarget,
            isTouchPointer(e) ? 'cancel' : 'commit',
          );
        }
        gesture.current = null;
        toolPointerId.current = null;
      }
    },
    [endToolGesture, releaseTouchTracking, edgeScroll, endZoomGesture],
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
      // The press this belongs to is either still choosing between a menu and a
      // pan, or has already been answered by `replayContextMenu`. Stopping
      // propagation is what keeps it from the trigger wrapping this element;
      // preventing the default is what keeps the browser's own menu shut.
      if (
        !replayingContextMenu.current &&
        (rightPointer.current || swallowContextMenu.current)
      ) {
        swallowContextMenu.current = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (!isSurfaceEvent(e.target)) return;
      const info = toInfo(e);
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
    [toInfo, isSurfaceEvent],
  );

  // Publish our viewport so peers following us can mirror it.
  useEffect(() => {
    if (size.width <= 0 || size.height <= 0) return;
    setLocalViewport(camera, size);
  }, [camera, size.width, size.height]);

  // Broadcast our follow state so the tutor can see who is following.
  useEffect(() => {
    setLocalFollowing(following);
  }, [following]);

  // Presence keeps the cursor position and glyph separate so existing peers
  // can fall back to the normal pointer while eraser-aware peers show a cross.
  useEffect(() => {
    setLocalCursorType(activeToolId === 'eraser' ? 'cross' : 'pointer');
  }, [activeToolId]);

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
  useEffect(() => clearLongPress, [clearLongPress]);

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

  // Keyboard: selection ops, z-order, delete, escape, and tool hotkeys.
  // (Full configurable shortcut sweep is Phase 27.)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      noteActivity();
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
          useSelectionStore
            .getState()
            .setSelection(duplicateShapes(editor, ids));
        }
        return;
      }
      if (mod && e.key === 'a') {
        e.preventDefault();
        useSelectionStore.getState().setSelection(
          editor
            .getShapes()
            .filter(isSelectable)
            .map((s) => s.id),
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
      // Style transfer, on the modifier pair Figma uses. Matched on `code`: on
      // macOS Option rewrites `key` to the character it composes (⌥C is 'ç'),
      // and it must come before the plain copy below, which on Windows/Linux
      // would otherwise claim Ctrl+Alt+C.
      if (mod && e.altKey && e.code === 'KeyC') {
        e.preventDefault();
        if (ids.length) copyStyle(editor, ids);
        return;
      }
      if (mod && e.altKey && e.code === 'KeyV') {
        e.preventDefault();
        if (ids.length) pasteStyle(editor, ids);
        return;
      }
      if (mod && !e.altKey && e.key === 'c') {
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
          deleteShapesWithCleanup(editor, cut);
          useSelectionStore.getState().clear();
        }
        return;
      }

      // Zoom (anchored at the viewport center).
      if (mod && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'in', s.baseZoom));
        return;
      }
      if (mod && e.key === '-') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        const s = useCameraStore.getState();
        s.zoomAtScreen(centerRef.current, nextDiscreteZoom(s.camera.z, 'out', s.baseZoom));
        return;
      }
      if (mod && e.key === '0') {
        e.preventDefault();
        stopFollowingForManualCameraChange();
        useCameraStore.getState().zoomAtScreen(centerRef.current, 1);
        return;
      }
      // Shift+1 frames the page, Shift+2 the selection. Matched on `code`
      // because Shift rewrites `key` to whatever the layout puts above the digit
      // ('@' above 2 on US, '"' on UK).
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit1') {
        e.preventDefault();
        onZoomToFit();
        return;
      }
      if (e.shiftKey && !mod && !e.altKey && e.code === 'Digit2') {
        e.preventDefault();
        onZoomToSelection();
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
        const dx =
          e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy =
          e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const moveIds = moveTargetIds(editor.getShapes(), ids);
        // Held arrow keys auto-repeat, and `moveIds` expands a selected
        // container to its whole subtree, so scanning `ids` from inside the loop
        // made a large selection quadratic on every repeat.
        const selectedIds = new Set(ids);
        editor.transact(() => {
          for (const id of moveIds) {
            const s = editor.getShape(id);
            // Locked descendants still follow an unlocked selected container;
            // locking protects direct edits, not the parent's transform.
            if (s && (!s.locked || !selectedIds.has(id))) {
              editor.updateShape(id, { x: s.x + dx, y: s.y + dy });
            }
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
          deleteShapesWithCleanup(editor, deletable);
          useSelectionStore.getState().clear();
        }
        return;
      }
      if ((e.key === 'Enter' || e.key === 'F2') && ids.length === 1) {
        const shape = editor.getShape(ids[0]!);
        if (shape?.type === 'frame' && !shape.locked) {
          e.preventDefault();
          useFrameEditingStore.getState().start(shape.id);
          return;
        }
        if (shape?.type === 'text' && !shape.locked) {
          e.preventDefault();
          useTextEditingStore.getState().start(shape.id, {
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
      // Hold Z to arm Quick Zoom — the press that follows aims the camera
      // rather than using the tool. No tool claims this key, so nothing is
      // shadowed; Cmd/Ctrl+Z has already returned above as undo.
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault();
        quickZoomArmed.current = true;
        return;
      }
      // Shape Lock: toggle the lock on the current selection. Must precede the
      // hotkey lookup, since byHotkey('L') would otherwise match the Line tool.
      if (e.shiftKey && (e.key === 'L' || e.key === 'l')) {
        e.preventDefault();
        if (ids.length) {
          const allLocked = ids.every((id) => editor.getShape(id)?.locked);
          editor.transact(() => {
            for (const id of ids)
              editor.updateShape(id, { locked: !allLocked });
          });
        }
        return;
      }
      // Flip. Like Shape Lock above, these must precede the hotkey lookup: the
      // bare keys belong to the Hand and Select tools.
      if (e.shiftKey && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        if (ids.length) flipShapes(editor, ids, 'horizontal');
        return;
      }
      if (e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault();
        if (ids.length) flipShapes(editor, ids, 'vertical');
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
        // Auto-repeat while a key is held is not a second press: re-arming on
        // it would record the borrowed tool as the one to return to.
        if (e.repeat) return;
        const from = useToolStore.getState().activeToolId;
        // Pressing the active tool's own key borrows nothing.
        spring.current =
          from === tool.id
            ? null
            : {
                key: e.key.toLowerCase(),
                from,
                to: tool.id,
                at: e.timeStamp,
                used: false,
              };
        useToolStore.getState().setTool(tool.id);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      if (e.key === 'z' || e.key === 'Z') {
        quickZoomArmed.current = false;
        // Letting go of the key mid-frame lands on the frame, same as letting
        // go of the pointer would.
        endQuickZoom(pointerRef.current);
      }
      releaseSpring(e);
      if (e.key !== 'Shift' && e.key !== 'Control' && e.key !== 'Meta') return;
      toolRegistry.get(useToolStore.getState().activeToolId)?.onKeyUp?.(e, ctx);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [ctx, releaseSpring, endQuickZoom, onZoomToFit, onZoomToSelection]);

  // The single paste path (Cmd+V). Prefers our own tagged copy (editable
  // shapes), then a clipboard image or PDF, then the in-app buffer as a
  // fallback. All pastes land at the pointer (viewport center when off-canvas).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const dt = e.clipboardData;
      const ours =
        hasClipboard() &&
        wbClipToken(dt?.getData('text/html') ?? '') === clipboardToken();

      const files: File[] = [];
      const pdfs: File[] = [];
      if (dt?.items) {
        for (let i = 0; i < dt.items.length; i++) {
          const item = dt.items[i]!;
          if (item.kind !== 'file') continue;
          const bucket = item.type.startsWith('image/')
            ? files
            : item.type === PDF_MIME
              ? pdfs
              : null;
          const f = bucket && item.getAsFile();
          if (f) bucket.push(f);
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
        // Its own undo step, matching pasted links below.
        breakUndoCapture();
        void placeImageFiles(files, world).then(selectPasted);
        return;
      }
      if (pdfs.length) {
        e.preventDefault();
        void placePdfFiles(pdfs, world).then(selectPasted);
        return;
      }
      const text = dt?.getData('text/plain') ?? '';
      // Pasted links become preview cards. `breakUndoCapture` makes the paste
      // its own undo step, so Ctrl+Z removes exactly what was just pasted.
      const urls = linkUrlsFromClipboard(text, dt?.getData('text/html') ?? '');
      if (urls) {
        e.preventDefault();
        breakUndoCapture();
        selectPasted(placeLinkUrls(urls, world));
        return;
      }
      // A bare video id is not a URL, so it never matches the link path above.
      const youtubeId = parseYoutubeId(text);
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

  // Drag-and-drop files onto the canvas: images and PDFs are placed at the drop
  // point, anything else goes to the board's document repository. A dropped PDF
  // matches a pasted one — it belongs under the pen, not behind a drawer — and
  // the repository's own upload button still takes one for filing.
  const onDragOver = useCallback((e: ReactDragEvent) => {
    if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
  }, []);
  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      const dropped = Array.from(e.dataTransfer.files);
      const images = dropped.filter((f) => f.type.startsWith('image/'));
      const pdfs = dropped.filter((f) => f.type === PDF_MIME);
      const documents = dropped.filter(
        (f) => !f.type.startsWith('image/') && f.type !== PDF_MIME,
      );
      if (!images.length && !pdfs.length && !documents.length) return;
      e.preventDefault();

      if (documents.length) {
        addFilesToRepository(documents, getLocalUser()?.name ?? 'Someone');
        // Reveal the repository so the file doesn't seem to vanish.
        useDocumentsStore.getState().setPanelOpen(true);
      }
      if (!images.length && !pdfs.length) return;

      const rect = getContainerRect(containerRef.current);
      const world = screenToWorld(
        { x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) },
        useCameraStore.getState().camera,
      );
      const select = (ids: string[]) => {
        if (ids.length) {
          useToolStore.getState().setTool('select');
          useSelectionStore.getState().setSelection(ids);
        }
      };
      if (images.length) void placeImageFiles(images, world).then(select);
      if (pdfs.length) void placePdfFiles(pdfs, world).then(select);
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
  const cursor =
    pan.isPanning || handDragging
      ? 'grabbing'
      : pan.isSpaceDown
        ? 'grab'
        : showDrawingCursor || showLaserCursor
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
        pointerRef.current = null;
      }}
    >
      <span id="canvas-keyboard-help" className="sr-only">
        Use the toolbars or single-key tool shortcuts to work on the board. Open
        Board actions, then Keyboard shortcuts, for the complete reference.
      </span>
      <CanvasSelectionStatus />
      {/* TEMPORARY bench flag — delete with ./zoom-bench.ts. */}
      {!bench.noBg && (
        <Background
          type={background}
          camera={camera}
          width={size.width}
          height={size.height}
        />
      )}

      {!bench.noShapes && (
        <FlatShapeLayer
          key={currentPageId}
          width={size.width}
          height={size.height}
        />
      )}

      {/* Mounted only while the local pointer is drawing, and paired with the
          `liveStrokeId` filter above so exactly one of the two draws that
          stroke. Its own element, so a stroke's per-frame churn never dirties
          the raster of the page-sized SVG behind it. */}
      {liveStrokeId && <ActiveStrokeLayer camera={camera} />}

      {/* Mounts only while something is fading out after a delete. */}
      <VanishLayer camera={camera} />

      {/* While the camera moves, an invisible blocker captures pointer hit-tests
          so the browser doesn't walk the overlay trees — selection handles,
          comment pins, peer cursors — every frame. The shape layer above opts
          out of hit-testing outright and never needed this. Pointer and wheel
          events still bubble to the container's handlers below it. */}
      {cameraMoving && (
        <div className="absolute inset-0 z-[var(--z-canvas-blocker)]" />
      )}

      <PeerSelectionLayer camera={camera} />
      {activeToolId === 'select' && !editingShape && !frameEditingShape && (
        <HoverLayer camera={camera} />
      )}
      {!editingShape && !frameEditingShape && (
        <SelectionLayer camera={camera} />
      )}
      {!editingShape && !frameEditingShape && (
        <SelectionToolbar camera={camera} />
      )}
      <CursorsLayer camera={camera} viewportSize={size} />
      <LaserLayer camera={camera} />
      <EraserTrail camera={camera} />
      <CommentsLayer camera={camera} />
      {quickZoomFrame && (
        <QuickZoomFrame
          center={quickZoomFrame.center}
          width={quickZoomFrame.width}
          height={quickZoomFrame.height}
        />
      )}
      {showDrawingCursor && <DrawingCursor containerRef={containerRef} />}
      {showLaserCursor && <LaserCursor containerRef={containerRef} />}

      {editingShape?.type === 'text' && (
        <TextEditorOverlay shape={editingShape} camera={camera} />
      )}

      {frameEditingShape?.type === 'frame' && (
        <FrameTitleEditorOverlay shape={frameEditingShape} camera={camera} />
      )}

      {playingShape?.type === 'video' && (
        <VideoPlayerOverlay shape={playingShape} camera={camera} />
      )}

      {croppingShape?.type === 'image' && (
        <ImageCropOverlay shape={croppingShape} camera={camera} />
      )}

      {minimapVisible && <Minimap />}

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
        minimapVisible={minimapVisible}
        onMinimapToggle={() => setMinimapVisible(!minimapVisible)}
        equations={equationItems}
        onEquationSelect={onEquationSelect}
      />

      {debugPerformance && <PerformanceOverlay />}
    </div>
  );
}
