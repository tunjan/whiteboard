import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';
import { rotatePoint } from '@whiteboard/shared';
import { noteActivity } from '@/collab/attention';
import { setLocalCursor } from '@/collab/presence';
import { stopFollowingForManualCameraChange } from '@/collab/use-follow-store';
import { type Camera, screenToWorld, zoomCameraAtScreen } from './camera';
import { getContainerRect, invalidateContainerRect } from './container-rect';
import { viewportWorldBounds } from './geometry';
import { isDoubleTap, oneFingerZoomFactor } from './one-finger-zoom';
import { PinchScheduler } from './pan-scheduler';
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
import {
  quickZoomBounds,
  quickZoomFrameSize,
  quickZoomOverviewZoom,
} from './quick-zoom';
import { unrotatedPoint } from './shapes/box-geometry';
import { plotArea } from './shapes/graph';
import { panViewport, zoomViewport } from './shapes/graph-interaction';
import {
  createGraphViewportWriter,
  type GraphViewportWriter,
} from './shapes/graph-viewport-writer';
import { isDarwin } from './platform';
import { springReturnTool, type SpringHold } from './spring-tool';
import { toolRegistry } from './tools/tool-registry';
import type { Tool, ToolContext, ToolPointerInfo } from './tools/types';
import { fingerDraws, isFingerTap, multiTouchTapAction } from './touch-input';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import {
  breakUndoCapture,
  editor,
  redo,
  spatialIndex,
  undo,
} from './use-document-store';
import { clearHover, updateHoverAt } from './use-hover-store';
import { useSelectionStore } from './use-selection-store';
import {
  MIDDLE_BUTTON,
  RIGHT_BUTTON,
  exceedsRightDragThreshold,
  type useSpacePan,
} from './use-space-pan';
import { useToolStore } from './use-tool-store';

// Which gesture a pointer on the canvas surface is: a stroke of the active
// tool, a pan, a pinch, one of the two zoom gestures, or a context menu. One
// object owns every piece of state that decision rests on, so the rules that
// span several events — palm rejection, a second finger cancelling the first,
// a dropped pointer-up healing itself — are read in one place, and "let go of
// everything" is one call.
//
// The tools keep their own state machines; this is the layer above them, which
// decides whether a tool sees the pointer at all.

function isTouchPointer(e: ReactPointerEvent): boolean {
  return e.pointerType === 'touch';
}

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

// A touch/pen that hasn't fired an event in this long is treated as released,
// even without a pointerup/cancel — recovers from iOS dropping those events.
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

/** `PointerEvent.buttons` bit for a stylus's eraser end (Pointer Events §4.1.1). */
const PEN_ERASER_BUTTONS = 32;

export interface QuickZoomFrameRect {
  center: { x: number; y: number };
  width: number;
  height: number;
}

/**
 * What the arbiter needs from the component it serves. Reassigned on every
 * render, so `pan` — whose callbacks close over React state — is always the
 * current one.
 */
export interface GestureHost {
  ctx: ToolContext;
  pan: ReturnType<typeof useSpacePan>;
  edgeScroll: {
    track: (at: { x: number; y: number }) => void;
    stop: () => void;
  };
  container: () => HTMLElement | null;
  viewportSize: () => { width: number; height: number };
  /** Quick Zoom's frame is the one piece of this that has to paint. */
  setQuickZoomFrame: (frame: QuickZoomFrameRect | null) => void;
}

export class GestureArbiter {
  /** Assigned by the owner before any event arrives, and again every render. */
  host!: GestureHost;

  /** Last pointer position in container pixels; paste lands here (null =
   *  off-canvas). */
  pointer: { x: number; y: number } | null = null;
  /** Quick Zoom: `Z` is held, so the next press aims the camera. */
  quickZoomArmed = false;

  // Which gesture owns the current pointer interaction.
  private gesture: 'pan' | 'tool' | 'zoom' | null = null;
  // The pointer currently driving `gesture` (so stray pointers are ignored).
  private toolPointerId: number | null = null;
  // A tool hotkey currently held down, and the tool it borrowed from. Null when
  // the last hotkey was a tap, or when the borrowed tool has been given back.
  // See `releaseSpring`.
  private spring: SpringHold | null = null;
  // Tool to return to once the current gesture ends, set when the hotkey came
  // up while the hand was still drawing. See `finishSpring`.
  private springReturn: string | null = null;
  // Live touch pointers on the surface, id → last-seen position (container px) and
  // timestamp. Drives single- vs multi-touch routing and the pinch math. iOS
  // routinely drops pointerup/cancel when the OS steals a gesture, so entries are
  // pruned by `reconcileStaleTouches` rather than trusted to clear themselves.
  private activeTouches = new Map<
    number,
    { x: number; y: number; t: number }
  >();
  // Where and when a finger-pan press started, while one is in flight. A press
  // that pans nowhere is replayed to the active tool as a tap on release, so a
  // finger that navigates can still point at things.
  private fingerTap: { x: number; y: number; t: number } | null = null;
  // A pen (Apple Pencil) is down: finger touches are palm-rejected while it is.
  private penActive = false;
  // Last time any pen event was seen — lets a dropped pen-up self-heal.
  private penLastSeen = 0;
  // The active two-finger pinch, or null. Owns the camera while ≥2 fingers are down.
  private pinch: PinchState | null = null;
  // The pinch's camera writes, one per frame however many finger moves land
  // in it — see `PinchScheduler`. Flushed before anything reads the camera the
  // pinch produced, and before its release coast starts.
  private pinchCamera = new PinchScheduler((time) => {
    // Measured off the camera rather than off the finger separation, so the
    // rate handed to the release coast is the one the board was actually
    // moving at — zero once a spread has run into the zoom limits, however
    // fast the fingers were still going.
    if (this.pinch)
      trackPinchZoom(this.pinch, useCameraStore.getState().camera.z, time);
  });
  // When a pinch begins over a selected graph, the writer for that graph's
  // viewport — the pinch then drives it instead of the board camera
  // (null = board pinch).
  private pinchGraph: GraphViewportWriter | null = null;
  // Finger separation last frame, for incremental graph-viewport zoom.
  private pinchLastDistance = 0;
  // The multi-finger gesture in flight, for the tap that means undo/redo: when
  // it started, the most fingers it ever carried, and whether it moved the
  // board. Resolved when the last finger lifts.
  private multiTouch: { t: number; fingers: number; moved: boolean } | null =
    null;
  // Latched once ≥2 fingers touch, cleared only when all lift — suppresses tool
  // routing for the rest of a pinch so lifting one finger never draws a stray mark.
  private pinchLatch = false;
  // A right-button press that has not yet decided between opening the context
  // menu and panning the board.
  private rightPointer: {
    id: number;
    x: number;
    y: number;
    dragged: boolean;
  } | null = null;
  // Whether the next `contextmenu` belongs to a right press this handler has
  // already dealt with, and must not reach the menu.
  private swallowContextMenu = false;
  // Set while dispatching our own `contextmenu`, which must not be swallowed.
  private replayingContextMenu = false;
  // Long-press → context menu (touch has no right-click).
  private longPressTimer: number | null = null;
  private longPressOrigin: { x: number; y: number } | null = null;
  // The last pointer info handed to the active tool, replayed when edge
  // scrolling moves the world out from under a stationary pointer.
  private lastToolInfo: ToolPointerInfo | null = null;
  // A finger's previous tap, for double-tap-and-drag zoom detection.
  private lastTap: { x: number; y: number; t: number } | null = null;
  // The live one-finger zoom: where it started and the camera it started from.
  private oneFingerZoom: {
    anchor: { x: number; y: number };
    camera: Camera;
  } | null = null;
  // The pressed Quick Zoom gesture's state.
  private quickZoom: { returnZoom: number; overviewZoom: number } | null = null;

  /** Stop the timers this owns. Safe to call more than once. */
  dispose(): void {
    this.clearLongPress();
    this.pinchCamera.cancel();
  }

  toInfo = (
    e: ReactPointerEvent | ReactMouseEvent | PointerEvent,
    // Optional pre-read container rect. `getContainerRect` serves a cache
    // (see `container-rect.ts`), so this is now a lookup rather than the
    // forced reflow it used to be; callers processing many coalesced samples
    // per event still pass their rect in to skip even that.
    rect?: DOMRect,
  ): ToolPointerInfo => {
    const r = rect ?? getContainerRect(this.host.container());
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
  };

  // The tool a gesture started with keeps it to the end, so a tool switch
  // mid-press (a hotkey, a tool handing off) cannot strand the old tool's
  // half-made shape while the new one receives a release it never saw begin.
  private gestureTool: Tool | undefined;

  private activeTool() {
    if (this.gesture === 'tool' && this.gestureTool) return this.gestureTool;
    return toolRegistry.get(useToolStore.getState().activeToolId);
  }

  /**
   * Select what a paste just placed — unless a press is still dragging,
   * resizing or drawing, which keeps the selection it is acting on.
   */
  selectPasted = (ids: string[]): void => {
    if (!ids.length || this.gesture === 'tool') return;
    useToolStore.getState().setTool('select');
    useSelectionStore.getState().setSelection(ids);
  };

  /**
   * End the tool gesture in flight, if any, from outside the pointer stream:
   * Escape cancels it, a tool hotkey commits it. Returns whether there was one.
   */
  endToolGestureNow = (mode: 'commit' | 'cancel'): boolean => {
    const target = this.host.container();
    if (this.gesture !== 'tool' || !target) return false;
    this.endToolGesture(target, mode);
    return true;
  };

  // True only for events that originate on the canvas DOM surface — excludes
  // in-canvas floating UI (data-ui-layer) and portaled popups/dialogs, whose
  // React events still bubble here but aren't DOM descendants of the canvas.
  isSurfaceEvent = (target: EventTarget | null): boolean => {
    const node = target as HTMLElement | null;
    if (!node || !this.host.container()?.contains(node)) return false;
    return !node.closest('[data-ui-layer]');
  };

  /** A tool hotkey went down: note what it borrowed, or that it borrowed nothing. */
  armSpring(hold: SpringHold | null): void {
    this.spring = hold;
  }

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
  releaseSpring(e: KeyboardEvent): void {
    const held = this.spring;
    if (!held || held.key !== e.key.toLowerCase()) return;
    this.spring = null;
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
    if (this.gesture === 'tool') {
      this.springReturn = to;
      return;
    }
    useToolStore.getState().setTool(to);
  }

  /** Complete a revert that was deferred until the gesture in flight ended. */
  private finishSpring(): void {
    const to = this.springReturn;
    if (to === null) return;
    this.springReturn = null;
    useToolStore.getState().setTool(to);
  }

  // Re-deliver the last pointer position to the active tool after the camera
  // has moved under it. The pointer is stationary on screen but the world point
  // beneath it is not, and a drag in flight is defined in world coordinates —
  // without this, edge scrolling would slide the board out from under the very
  // shape being dragged to the edge.
  dispatchSyntheticMove = (): void => {
    const previous = this.lastToolInfo;
    if (!previous || this.gesture !== 'tool') return;
    const camera = useCameraStore.getState().camera;
    const point = screenToWorld(previous.screenPoint, camera);
    if (
      point.x === previous.point.x &&
      point.y === previous.point.y &&
      camera.z === previous.zoom
    )
      return;
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
    this.lastToolInfo = info;
    this.activeTool()?.onPointerMove?.(info, this.host.ctx);
  };

  private releaseCapture(target: Element, id: number | null): void {
    if (id !== null && target.hasPointerCapture(id)) {
      target.releasePointerCapture(id);
    }
  }

  private dropGesture(): void {
    this.gesture = null;
    this.gestureTool = undefined;
    this.toolPointerId = null;
  }

  // End the active tool gesture, either committing it (the pointer lifted
  // normally) or cancelling it (a pinch/pen stole the interaction).
  private endToolGesture(target: Element, mode: 'commit' | 'cancel'): void {
    const id = this.toolPointerId;
    this.host.edgeScroll.stop();
    this.lastToolInfo = null;
    const wasToolGesture = this.gesture === 'tool';
    if (wasToolGesture) {
      const tool = this.activeTool();
      // 'commit' keeps what was drawn (the OS reclaimed a pen/mouse pointer);
      // tools without onCommit fall back to discarding via onCancel.
      if (mode === 'commit' && tool?.onCommit) tool.onCommit(this.host.ctx);
      else tool?.onCancel?.(this.host.ctx);
      // `pointercancel` and `lostpointercapture` bypass the normal
      // pointer-up path below. They still finish a gesture, so they must end
      // Yjs's capture window or the next stroke can be merged into this one.
      breakUndoCapture();
    }
    this.releaseCapture(target, id);
    this.dropGesture();
    if (wasToolGesture) this.finishSpring();
  }

  private startToolGesture(e: ReactPointerEvent): void {
    // Make every new gesture an undo boundary as a fallback for browsers
    // that drop a preceding pointer-up/cancel event.
    breakUndoCapture();
    // Using a tool is what makes a held hotkey a hold rather than a tap, so
    // the gesture is what the spring springs back from.
    if (this.spring) this.spring.used = true;
    this.gesture = 'tool';
    this.gestureTool = toolRegistry.get(useToolStore.getState().activeToolId);
    this.toolPointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const info = this.toInfo(e);
    this.lastToolInfo = info;
    this.activeTool()?.onPointerDown?.(info, this.host.ctx);
  }

  // A pointer position in container (canvas-relative) pixels.
  private screenPointOf(e: { clientX: number; clientY: number }) {
    const rect = getContainerRect(this.host.container());
    return {
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
    };
  }

  // Publish immediately when the pointer enters or presses the board, not just
  // after it moves. This keeps a peer marker visible for clicks and taps too.
  publishCursorPosition = (
    clientX: number,
    clientY: number,
    rect?: DOMRect,
  ): void => {
    const r = rect ?? getContainerRect(this.host.container());
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
    this.pointer = screen;
    noteActivity();
    setLocalCursor(screenToWorld(screen, useCameraStore.getState().camera));
  };

  /**
   * Tear the pinch down. The three places a pinch can end differ in exactly
   * these two ways: whether the camera write still queued is applied or
   * dropped, and whether a graph pinch closes its undo step.
   */
  private endPinch(camera: 'flush' | 'cancel', endUndoStep: boolean): void {
    if (camera === 'flush') this.pinchCamera.flush();
    else this.pinchCamera.cancel();
    this.pinch = null;
    if (this.pinchGraph) {
      // Write the last frame, then end the capture window so the whole
      // pinch is one undo step.
      this.pinchGraph.flush();
      if (endUndoStep) breakUndoCapture();
      this.pinchGraph = null;
    }
  }

  // Drop touch/pen state that no longer reflects a finger on the glass. iOS can
  // swallow the pointerup/cancel that would normally clear it (system gesture,
  // edge swipe, Stage Manager), which would otherwise leave the canvas latched
  // and unresponsive. Pruning on the next interaction lets it self-heal.
  private reconcileStaleTouches(now: number): void {
    pruneStaleTouches(this.activeTouches, now, STALE_TOUCH_MS);
    if (this.activeTouches.size < 2) this.endPinch('flush', false);
    if (this.activeTouches.size === 0) this.pinchLatch = false;
    if (this.penActive && now - this.penLastSeen > STALE_TOUCH_MS) {
      this.penActive = false;
    }
  }

  // The sole selected graph whose plot area contains `screen` (container px), or
  // null. Used to route a pinch to a graph viewport instead of the camera.
  private graphAtScreenPoint(screen: { x: number; y: number }): string | null {
    const sel = useSelectionStore.getState().selectedIds;
    if (sel.length !== 1) return null;
    const shape = editor.getShape(sel[0]!);
    if (!shape || shape.type !== 'graph') return null;
    // The plot area is upright in the shape's own frame.
    const world = unrotatedPoint(
      shape.x,
      shape.y,
      shape.props.w,
      shape.props.h,
      shape.rotation,
      screenToWorld(screen, useCameraStore.getState().camera),
    );
    const area = plotArea(shape);
    const inside =
      world.x >= area.x &&
      world.x <= area.x + area.w &&
      world.y >= area.y &&
      world.y <= area.y + area.h;
    return inside ? shape.id : null;
  }

  // Capture the start of a two-finger pinch from the two live touch points.
  private beginPinch(): void {
    const pts = [...this.activeTouches.values()];
    if (pts.length < 2) return;
    const g = pinchGesture(pts[0]!, pts[1]!);
    this.pinch = {
      startDistance: g.distance,
      startZoom: useCameraStore.getState().camera.z,
      startMidpoint: g.midpoint,
      lastMidpoint: g.midpoint,
      mode: 'unsure',
      zoomRate: 0,
      lastZoom: useCameraStore.getState().camera.z,
      lastZoomTime: performance.now(),
    };
    this.pinchLastDistance = g.distance;
    // If the pinch lands inside the sole selected graph's plot, it adjusts that
    // graph's viewport; otherwise it's a normal board pinch.
    const graphId = this.graphAtScreenPoint(g.midpoint);
    this.pinchGraph = graphId ? createGraphViewportWriter(graphId) : null;
    if (!graphId) stopFollowingForManualCameraChange();
  }

  // Quick Zoom: pull back far enough to see the whole board, frame somewhere
  // with the pointer, release to fly there.
  private beginQuickZoom(e: ReactPointerEvent): boolean {
    const { width, height } = this.host.viewportSize();
    if (width <= 0 || height <= 0) return false;
    const point = this.screenPointOf(e);
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
    this.quickZoom = { returnZoom: camera.z, overviewZoom };
    this.gesture = 'zoom';
    this.toolPointerId = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    store.setCamera(zoomCameraAtScreen(camera, point, overviewZoom));
    this.host.setQuickZoomFrame({
      center: point,
      ...quickZoomFrameSize(overviewZoom, camera.z, width, height),
    });
    return true;
  }

  // Drop out of Quick Zoom, optionally landing on the framed region.
  endQuickZoom(point: { x: number; y: number } | null): void {
    const active = this.quickZoom;
    this.quickZoom = null;
    this.host.setQuickZoomFrame(null);
    if (!active) return;
    if (point) {
      useCameraStore.getState().animateZoomAtScreen(point, active.returnZoom);
    }
  }

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
  private abandonGesture(target: Element): void {
    if (this.gesture !== 'pan') {
      this.endToolGesture(target, 'cancel');
      return;
    }
    const id = this.toolPointerId;
    this.fingerTap = null;
    this.host.pan.cancel();
    this.releaseCapture(target, id);
    this.dropGesture();
    this.host.edgeScroll.stop();
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== null) {
      window.clearTimeout(this.longPressTimer);
      this.longPressTimer = null;
    }
    this.longPressOrigin = null;
  }

  /**
   * Let go of everything, because the page under the gesture is being switched
   * away. A stroke in flight is kept rather than discarded: the hand did draw
   * it, on the page it was drawn on.
   */
  abandonAll = (): void => {
    this.clearLongPress();
    const target = this.host.container();
    const pointerId = this.toolPointerId;
    if (this.gesture === 'tool' && target) {
      this.endToolGesture(target, 'commit');
    } else if (this.gesture === 'pan') {
      this.dropGesture();
      this.fingerTap = null;
      this.host.pan.cancel();
      if (target) this.releaseCapture(target, pointerId);
    }
    if (this.gesture === 'zoom') this.dropGesture();
    this.oneFingerZoom = null;
    this.lastTap = null;
    this.endQuickZoom(null);
    this.host.edgeScroll.stop();
    this.activeTouches.clear();
    this.endPinch('cancel', true);
    this.pinchLatch = false;
    this.multiTouch = null;
    this.penActive = false;
    this.pointer = null;
  };

  // Arm a long-press on a one-finger touch: holding still for ~500ms aborts the
  // in-progress stroke and opens the context menu (touch has no right-click).
  // Dispatching a native `contextmenu` lets the existing onContextMenu select the
  // shape and the ContextMenuTrigger open — no duplicated logic.
  private armLongPress(e: ReactPointerEvent): void {
    const cx = e.clientX;
    const cy = e.clientY;
    const target = e.currentTarget;
    this.longPressOrigin = { x: cx, y: cy };
    this.longPressTimer = window.setTimeout(() => {
      this.longPressTimer = null;
      this.longPressOrigin = null;
      this.abandonGesture(target);
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
  }

  /**
   * Open the context menu for a right press that turned out not to be a pan.
   *
   * A right press cannot mean "menu" until the pointer lifts — until then it
   * might be a drag — so the `contextmenu` the browser fires for the press is
   * swallowed and this dispatches one in its place at the release point. Same
   * mechanism as the touch long-press above, and the same reason: it opens the
   * menu through the path that already exists rather than a second one.
   */
  private replayContextMenu(e: ReactPointerEvent): void {
    const target =
      document.elementFromPoint(e.clientX, e.clientY) ?? e.currentTarget;
    this.replayingContextMenu = true;
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
    this.replayingContextMenu = false;
  }

  /**
   * Whether a `contextmenu` must be kept from the menu: the press it belongs to
   * is either still choosing between a menu and a pan, or has already been
   * answered by `replayContextMenu`. Asking consumes the answer.
   */
  takeContextMenuSwallow(): boolean {
    if (
      this.replayingContextMenu ||
      !(this.rightPointer || this.swallowContextMenu)
    )
      return false;
    this.swallowContextMenu = false;
    return true;
  }

  onPointerDown = (e: ReactPointerEvent): void => {
    const pan = this.host.pan;
    // One measurement per gesture, so a rectangle that went stale for a
    // reason the invalidation listeners don't cover cannot mislocate a whole
    // stroke — only the moment before the hand landed.
    useCameraStore.getState().stopCameraAnimation();
    invalidateContainerRect();
    this.publishCursorPosition(e.clientX, e.clientY);
    // The hover outline promises what a click would catch; once the click has
    // happened the selection box says it instead.
    clearHover();
    // A right press released somewhere this element never saw would otherwise
    // leave the next context menu swallowed.
    this.rightPointer = null;
    this.swallowContextMenu = false;

    // Touch: one finger either drives the active tool or pans the board (see
    // `fingerAction`); two fingers are always a pinch/pan.
    if (isTouchPointer(e)) {
      this.reconcileStaleTouches(e.timeStamp);
      if (this.penActive) return; // palm rejection while the pen is down
      this.activeTouches.set(e.pointerId, {
        ...this.screenPointOf(e),
        t: e.timeStamp,
      });
      if (this.activeTouches.size >= 2) {
        // Second finger down → a pinch is starting: abort the one-finger
        // gesture (the pinch branch in onPointerMove owns the camera now)
        // and mute tool routing.
        this.pinchLatch = true;
        this.clearLongPress();
        this.abandonGesture(e.currentTarget);
        // Only fingers on the board itself: two of them on a panel are a
        // scroll or a stray rest, not a command aimed at the document.
        if (this.isSurfaceEvent(e.target)) {
          const tap = this.multiTouch;
          this.multiTouch = tap
            ? {
                ...tap,
                fingers: Math.max(tap.fingers, this.activeTouches.size),
              }
            : {
                t: e.timeStamp,
                fingers: this.activeTouches.size,
                moved: false,
              };
        }
        this.beginPinch();
        return;
      }
      if (this.pinchLatch) return; // mid-pinch: wait until all fingers lift
      if (!this.isSurfaceEvent(e.target)) return;
      const ui = useCanvasUiStore.getState();
      const drives = fingerDraws(ui.fingerAction, ui.penSeen);
      // Double-tap and hold, then drag, to zoom with one finger. Under the
      // stroke tools that same gesture is two dots and a line, so it is
      // offered only where nothing is being accumulated — which, once the
      // finger no longer draws at all, is everywhere.
      const point = this.screenPointOf(e);
      if (
        (!drives ||
          ONE_FINGER_ZOOM_TOOLS.has(useToolStore.getState().activeToolId)) &&
        isDoubleTap(this.lastTap, point, e.timeStamp)
      ) {
        this.lastTap = null;
        stopFollowingForManualCameraChange();
        this.oneFingerZoom = {
          anchor: point,
          camera: { ...useCameraStore.getState().camera },
        };
        this.gesture = 'zoom';
        this.toolPointerId = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        return;
      }
      this.lastTap = { ...point, t: e.timeStamp };
      if (!drives) {
        // The finger moves the board instead. Same drag machinery the middle
        // button and Space use, so it inherits the release coast.
        stopFollowingForManualCameraChange();
        this.gesture = 'pan';
        this.toolPointerId = e.pointerId;
        this.fingerTap = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        pan.beginPan(e);
        this.armLongPress(e);
        return;
      }
      this.startToolGesture(e);
      // A held eraser is still an erase gesture. Other touch tools keep the
      // long-press context menu, but cancelling an eraser after 500ms would
      // undo the exact sustained gesture this tool is meant to support.
      if (useToolStore.getState().activeToolId !== 'eraser')
        this.armLongPress(e);
      return;
    }

    // Mouse / pen.
    if (!this.isSurfaceEvent(e.target)) return;
    if (e.pointerType === 'pen') {
      this.penActive = true;
      this.penLastSeen = e.timeStamp;
      // The one fact `fingerAction: 'auto'` turns on: a stylus exists here.
      useCanvasUiStore.getState().notePenSeen();
      // A resting finger may have started a stray stroke first — discard it.
      // But a *pen*-started gesture still active here means the previous
      // stroke's pointerup/lostpointercapture was dropped (common on Wacom
      // tablets, which bump the pointerId each stroke); commit that finished
      // stroke, don't delete it.
      const priorWasTouch =
        this.toolPointerId !== null &&
        this.activeTouches.has(this.toolPointerId);
      if (priorWasTouch) {
        // The palm's long press would otherwise fire mid-stroke and cancel
        // the pen's gesture; a palm pan has to end too, not just be overwritten.
        this.clearLongPress();
        this.abandonGesture(e.currentTarget);
      } else if (this.gesture === 'tool' && this.toolPointerId !== e.pointerId) {
        this.endToolGesture(e.currentTarget, 'commit');
      }
      // Fingers already down are a palm, not a pinch or a two-finger tap: left
      // live, they zoom the board once the pen lifts, or undo its stroke when
      // they do. `pinchLatch` keeps them inert until every one has lifted.
      if (this.activeTouches.size > 0) {
        this.endPinch('cancel', true);
        this.multiTouch = null;
        this.pinchLatch = true;
      }
    }
    // Quick Zoom takes the press before any tool sees it: `Z` is held, so
    // this press is aiming the camera, not using the tool.
    if (this.quickZoomArmed && this.beginQuickZoom(e)) return;
    // Right-drag pans too, but only once the press has travelled: until then
    // it is still a context menu, which `onPointerUp` opens on release. On a
    // Mac, Ctrl+click is a right-click: the OS fires `contextmenu` for it, so
    // handing it to the tool as well left a stray dot or selection behind.
    if (
      e.button === RIGHT_BUTTON ||
      (e.button === 0 &&
        e.ctrlKey &&
        !e.metaKey &&
        e.pointerType === 'mouse' &&
        isDarwin())
    ) {
      this.rightPointer = {
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
      this.gesture = 'pan';
      this.toolPointerId = e.pointerId;
      pan.beginPan(e);
      return;
    }
    // A stylus turned over to its eraser end erases for that one stroke and
    // hands the pen back on lift — the same borrow a held E makes.
    if (e.pointerType === 'pen' && e.buttons & PEN_ERASER_BUTTONS) {
      const from = useToolStore.getState().activeToolId;
      useToolStore.getState().setTool('eraser');
      if (from !== 'eraser' && useToolStore.getState().activeToolId === 'eraser')
        this.springReturn = from;
    }
    this.startToolGesture(e);
  };

  onPointerMove = (e: ReactPointerEvent): void => {
    const { pan, ctx, edgeScroll } = this.host;
    if (isTouchPointer(e) && this.penActive) return;
    const rect = getContainerRect(this.host.container());
    if (rect) {
      this.pointer = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };
    }
    // Skip the presence cursor while pinching (two fingers, jittery midpoint).
    if (rect && !(isTouchPointer(e) && this.pinchLatch)) {
      this.publishCursorPosition(e.clientX, e.clientY, rect);
    }
    // What a click would select, outlined. Only while the select tool is idle:
    // a pointer already in a gesture is committed to it, and no other tool
    // acts on whatever happens to be underneath. Space-panning holds no
    // button, so the gesture is checked as well as the buttons.
    if (
      rect &&
      e.buttons === 0 &&
      this.gesture === null &&
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
    if (this.longPressOrigin) {
      const dx = e.clientX - this.longPressOrigin.x;
      const dy = e.clientY - this.longPressOrigin.y;
      if (Math.hypot(dx, dy) > 10) this.clearLongPress();
    }
    if (e.pointerType === 'pen') this.penLastSeen = e.timeStamp;
    // Past the click slop, the right press was a drag: hand it to the same pan
    // machinery the middle button and Space use.
    const right = this.rightPointer;
    if (
      right &&
      e.pointerId === right.id &&
      !right.dragged &&
      exceedsRightDragThreshold(e.clientX - right.x, e.clientY - right.y)
    ) {
      right.dragged = true;
      stopFollowingForManualCameraChange();
      this.gesture = 'pan';
      this.toolPointerId = e.pointerId;
      pan.beginPan(e);
    }
    // Keep each live finger's position fresh and, while two are down, drive the
    // pinch directly from them (single source of truth — no separate Touch
    // Events listener that could desync from this routing).
    if (rect && isTouchPointer(e) && this.activeTouches.has(e.pointerId)) {
      this.activeTouches.set(e.pointerId, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        t: e.timeStamp,
      });
      if (this.pinch && this.activeTouches.size >= 2) {
        const pinch = this.pinch;
        const pts = [...this.activeTouches.values()];
        const g = pinchGesture(pts[0]!, pts[1]!);
        const graph = this.pinchGraph;
        if (graph) {
          // Drive the graph viewport: spread to zoom in, drag to pan.
          const shape = editor.getShape(graph.shapeId);
          if (shape && shape.type === 'graph') {
            const camera = useCameraStore.getState().camera;
            const area = plotArea(shape);
            const { x, y, rotation } = shape;
            // Both the anchor and the finger travel are taken in the plot's
            // own upright frame, so a rotated graph zooms about the fingers
            // and pans along its own axes.
            const anchor = unrotatedPoint(
              x,
              y,
              shape.props.w,
              shape.props.h,
              rotation,
              screenToWorld(g.midpoint, camera),
            );
            const travel = rotatePoint(
              {
                x: (g.midpoint.x - pinch.lastMidpoint.x) / camera.z,
                y: (g.midpoint.y - pinch.lastMidpoint.y) / camera.z,
              },
              { x: 0, y: 0 },
              -rotation,
            );
            const factor =
              g.distance > 0 ? this.pinchLastDistance / g.distance : 1;
            // Content follows the fingers → window moves opposite the midpoint.
            graph.update((viewport) =>
              panViewport(
                zoomViewport(viewport, area, anchor, factor),
                area,
                -travel.x,
                -travel.y,
              ),
            );
          }
          pinch.lastMidpoint = g.midpoint;
          this.pinchLastDistance = g.distance;
          if (this.multiTouch) this.multiTouch.moved = true;
          return;
        }
        // Two fingers can mean either a pan or a zoom, and committing to one
        // keeps a gesture that was meant as a drag from also re-scaling the
        // board (which would re-cut the cull region on every frame).
        const mode = nextPinchMode(
          pinch.mode,
          { distance: pinch.startDistance, midpoint: pinch.startMidpoint },
          g,
        );
        if (mode === 'zooming' && pinch.mode !== 'zooming') {
          // Re-baseline on the transition: the fingers already crossed the
          // threshold, and scaling from the original separation would jump.
          this.pinchCamera.flush();
          pinch.startDistance = g.distance;
          pinch.startZoom = useCameraStore.getState().camera.z;
        }
        pinch.mode = mode;
        if (mode !== 'unsure' && this.multiTouch) {
          this.multiTouch.moved = true;
        }
        if (mode !== 'unsure') {
          this.pinchCamera.push(
            g.midpoint,
            mode === 'panning'
              ? pinch.startZoom
              : zoomFromDistance(
                  pinch.startZoom,
                  pinch.startDistance,
                  g.distance,
                ),
            (g.midpoint.x - pinch.lastMidpoint.x) * TOUCH_PAN_SPEED,
            (g.midpoint.y - pinch.lastMidpoint.y) * TOUCH_PAN_SPEED,
            e.timeStamp,
          );
        }
        // Tracked even while undecided so the deadband discards that motion
        // instead of releasing it as one jump when the mode resolves.
        pinch.lastMidpoint = g.midpoint;
        return;
      }
    }
    if (e.pointerId !== this.toolPointerId) return;
    if (this.gesture === 'zoom') {
      const point = {
        x: e.clientX - (rect?.left ?? 0),
        y: e.clientY - (rect?.top ?? 0),
      };
      const zooming = this.oneFingerZoom;
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
              zooming.camera.z *
                oneFingerZoomFactor(point.y - zooming.anchor.y),
            ),
          );
      } else if (this.quickZoom) {
        const { overviewZoom, returnZoom } = this.quickZoom;
        const size = this.host.viewportSize();
        this.host.setQuickZoomFrame({
          center: point,
          ...quickZoomFrameSize(
            overviewZoom,
            returnZoom,
            size.width,
            size.height,
          ),
        });
      }
      return;
    }
    if (this.gesture === 'pan') {
      pan.onPointerMove(e);
    } else if (this.gesture === 'tool') {
      // Pointer Events may combine high-frequency hardware samples into one
      // dispatch. Point-accumulating tools (see `wantsCoalescedSamples`) opt
      // into receiving every sample, which preserves pen curves; the draw
      // tool then applies its zoom-aware decimation in world space. Everyone
      // else gets the dispatched position only — for a tool that just tracks
      // where the pointer is, the earlier samples are overwritten in the same
      // frame, so running the full mutation pipeline for each was pure waste.
      const tool = this.activeTool();
      if (!tool?.onPointerMove) return;
      const coalesced = tool.wantsCoalescedSamples
        ? (e.nativeEvent.getCoalescedEvents?.() ?? [])
        : [];
      if (coalesced.length) {
        for (const sample of coalesced) {
          tool.onPointerMove(this.toInfo(sample, rect), ctx);
        }
      }
      const info = this.toInfo(e.nativeEvent, rect);
      if (tool.wantsPredictedSamples) {
        // Predicted samples ride along on the dispatched move only; they are
        // re-derived every event, so stale predictions never accumulate.
        const predicted = e.nativeEvent.getPredictedEvents?.() ?? [];
        if (predicted.length) {
          info.predicted = predicted.map((sample) => {
            const p = this.toInfo(sample, rect);
            return {
              x: p.point.x,
              y: p.point.y,
              pressure: p.pressure,
              t: p.timestamp,
            };
          });
        }
      }
      this.lastToolInfo = info;
      tool.onPointerMove(info, ctx);
      // Held against an edge, the drag keeps going by moving the board
      // instead — but not for the hand tool, which *is* the board moving.
      if (tool.id === 'hand') edgeScroll.stop();
      else edgeScroll.track(info.screenPoint);
    }
  };

  // Forget a pointer that is no longer on the glass. Called from every path a
  // touch/pen can end through — pointerup, pointercancel, and lostpointercapture
  // — so it must stay idempotent.
  private releaseTouchTracking(e: ReactPointerEvent): void {
    if (e.pointerType === 'pen') this.penActive = false;
    if (!isTouchPointer(e)) return;
    this.activeTouches.delete(e.pointerId);
    if (this.activeTouches.size < 2) this.endPinch('flush', true);
    if (this.activeTouches.size === 0) {
      this.pinchLatch = false;
      // Resolved on the way out rather than on the way in: whether fingers that
      // went down together were a command or the start of a pinch is only
      // settled by what they did before lifting.
      const tap = this.multiTouch;
      this.multiTouch = null;
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
  }

  private releaseTouch(e: ReactPointerEvent): void {
    this.clearLongPress();
    this.releaseTouchTracking(e);
  }

  /** Close out a Quick Zoom / one-finger zoom gesture. */
  private endZoomGesture(e: ReactPointerEvent, land: boolean): void {
    this.oneFingerZoom = null;
    this.endQuickZoom(land ? this.screenPointOf(e) : null);
    this.releaseCapture(e.currentTarget, e.pointerId);
    this.dropGesture();
  }

  /**
   * How a tool gesture ends when its pointer is taken away rather than lifted.
   * A pen/mouse cancel is almost always a spurious OS event, not a real
   * gesture takeover — keep the in-progress stroke/drag. Touch keeps
   * discarding (a genuine pinch is interrupting a one-finger gesture).
   */
  private takenAway(e: ReactPointerEvent): 'commit' | 'cancel' {
    return isTouchPointer(e) ? 'cancel' : 'commit';
  }

  onPointerUp = (e: ReactPointerEvent): void => {
    const { pan, ctx } = this.host;
    // Fingers leaving mid-spread keep the scale moving, the way a released
    // pan keeps travelling. Read before `releaseTouch`, which tears the pinch
    // down; `size === 2` is this finger plus the one still on the glass.
    if (
      isTouchPointer(e) &&
      this.pinch &&
      !this.pinchGraph &&
      this.activeTouches.size === 2
    ) {
      this.pinchCamera.flush();
      const zoomRate = pinchReleaseZoomRate(this.pinch, e.timeStamp);
      if (zoomRate !== 0) {
        useCameraStore.getState().slideCamera({ x: 0, y: 0 }, zoomRate);
      }
    }
    const right = this.rightPointer;
    if (right && e.pointerId === right.id) {
      this.rightPointer = null;
      // Platforms disagree about whether `contextmenu` rides the press or the
      // release, so swallow either way and let the replay open the menu.
      this.swallowContextMenu = true;
      if (!right.dragged) this.replayContextMenu(e);
    }
    this.releaseTouch(e);
    this.host.edgeScroll.stop();
    if (e.pointerId !== this.toolPointerId) return;
    if (this.gesture === 'zoom') {
      this.endZoomGesture(e, true);
      return;
    }
    if (this.gesture === 'pan') {
      const started = this.fingerTap;
      this.fingerTap = null;
      if (
        started &&
        isFingerTap(started, { x: e.clientX, y: e.clientY, t: e.timeStamp })
      ) {
        // The press panned nowhere, so it was a point rather than a drag:
        // the tool sees an ordinary click and select, comment and sticker
        // all work from a finger that otherwise only moves the board.
        // Replayed before the release below, which would otherwise hand the
        // camera whatever velocity the lift shook out of a stationary press.
        const tool = this.activeTool();
        const info = this.toInfo(e);
        tool?.onPointerDown?.(info, ctx);
        tool?.onPointerUp?.(info, ctx);
        breakUndoCapture();
      }
      pan.onPointerUp(e);
    }
    const wasToolGesture = this.gesture === 'tool';
    if (wasToolGesture) {
      this.activeTool()?.onPointerUp?.(this.toInfo(e), ctx);
      breakUndoCapture();
      this.releaseCapture(e.currentTarget, e.pointerId);
    }
    this.dropGesture();
    // After the gesture is closed out, so the tool this hands back to enters
    // with nothing in flight.
    if (wasToolGesture) this.finishSpring();
  };

  // The browser fires pointercancel when it steals a touch (e.g. a pinch is
  // recognized) — abort the in-progress gesture rather than committing it.
  onPointerCancel = (e: ReactPointerEvent): void => {
    if (this.rightPointer?.id === e.pointerId) this.rightPointer = null;
    this.releaseTouch(e);
    this.host.edgeScroll.stop();
    if (e.pointerId !== this.toolPointerId) return;
    if (this.gesture === 'zoom') {
      // A cancelled framing gesture leaves the camera where it is rather than
      // flying somewhere the user did not choose.
      this.endZoomGesture(e, false);
      return;
    }
    if (this.gesture === 'pan') {
      this.host.pan.onPointerUp(e);
      this.fingerTap = null;
      this.dropGesture();
    } else {
      this.endToolGesture(e.currentTarget, this.takenAway(e));
    }
  };

  // Capture being lost (the OS reclaiming the pointer) is a second signal that a
  // touch/pen has gone, in case its pointerup/cancel was dropped. Cleaning up here
  // too keeps the latch from outliving the gesture.
  onLostPointerCapture = (e: ReactPointerEvent): void => {
    if (this.rightPointer?.id === e.pointerId) this.rightPointer = null;
    this.releaseTouchTracking(e);
    this.host.edgeScroll.stop();
    if (e.pointerId === this.toolPointerId && this.gesture === 'zoom') {
      this.endZoomGesture(e, false);
      return;
    }
    if (e.pointerId === this.toolPointerId) {
      if (this.gesture === 'tool') {
        this.endToolGesture(e.currentTarget, this.takenAway(e));
      }
      this.dropGesture();
    }
  };
}
