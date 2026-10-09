import { LassoGlyph } from '@/components/ui/glyphs';
import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  boundsContainsPoint,
  distance,
  rotatePoint,
} from '@whiteboard/shared';
import {
  getSelectionInfo,
  hitSelectionHandle,
  HANDLE_HIT_SCREEN,
  marqueeIntersectsMask,
  matchesMarquee,
  shapeRotatedBounds,
  type MarqueeMode,
  type ResizeHandleId,
  type SelectionInfo,
} from '../selection-geometry';
import { resizeCursor } from '../resize-cursor';
import { isCoarsePointer } from '../platform';
import {
  descendantsOf,
  findCommonAncestor,
  leafDescendants,
  moveTargetIds,
  selectionTargetId,
} from '../hierarchy';
import {
  fitFrameToContent,
  kickoutOccludedFrameChildren,
  movingSubtreeIds,
  selectionRoots,
  topFrameOverlappingShape,
} from '../frame-operations';
import { requestEquationFocus } from '../equation-focus';
import { mirrorShapeLocally } from '../flip';
import { getSnapGridStep } from '../grid';
import { safeLinkUrl } from '../link-url';
import { isSelectable } from '../selectable';
import { useHiddenStore } from '../use-hidden-store';
import { hitTestCanvas } from '../engine/hit-test';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { shapeRegistry } from '../shapes/shape-registry';
import { findBindableShapeAt } from '../shapes/connector-routing';
import { textIndexAtWorldPoint } from '../shapes/text';
import { layoutTextProps, MIN_TEXT_WIDTH } from '../shapes/text-measure';
import type { ShapeUtil } from '../shapes/types';
import { selfSnapTarget, shapeSnapGeometry } from '../snap-geometry';
import {
  SNAP_SCREEN,
  snapRegion,
  snapTargetBounds,
  snapTargetShapes,
} from '../snap-targets';
import {
  type BoundsSnapTarget,
  type PointSnapTarget,
  boundsSnapPoints,
  shortAngleDist,
  snapAngle,
  snapBounds,
  snapPoint,
  snapResizeBounds,
} from '../snapping';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { useTextEditingStore } from '../use-text-editing-store';
import { useFrameEditingStore } from '../use-frame-editing-store';
import { useVideoPlayingStore } from '../use-video-playing-store';
import { useImageCroppingStore } from '../use-image-cropping-store';
import type { Editor } from '../editor';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/** Screen-px slop around the pointer when picking a shape. */
export const SHAPE_HIT_SCREEN = 4;
const DRAG_SLOP_SCREEN = 3;
const ROTATE_SNAP = (15 * Math.PI) / 180;
const RIGHT_ANGLE_SNAP = Math.PI / 2;
const COARSE_ROTATE_TOLERANCE = (5 * Math.PI) / 180;
const ONE_DEGREE = Math.PI / 180;
const TAU = Math.PI * 2;
const MIN_RESIZE = 1;

interface GroupItem {
  initial: Shape;
  util: ShapeUtil;
  /** The shape's unrotated bounds at gesture start. */
  b0: Bounds;
  /** Page centre of `b0`, which is also the point the shape rotates about. */
  center0: Point;
  /**
   * Quarter turns between the shape's own rotation and the selection axis:
   * 0 and 2 scale width by sx, 1 and 3 swap the axes. `null` means the shape
   * sits off-axis, where a per-axis scale would shear it.
   */
  quarterTurns: number | null;
}

interface RotationItem {
  initial: Shape;
  center: Point;
}

type Axis = 'x' | 'y';

type SelectState =
  | { type: 'idle' }
  | {
      type: 'pending-shape';
      start: Point;
      screenStart: Point;
      targetId: string;
      selectionBefore: string[];
      targetWasSelected: boolean;
      additive: boolean;
    }
  | {
      type: 'pending-selection';
      start: Point;
      screenStart: Point;
      selectionBefore: string[];
    }
  | {
      type: 'pending-empty';
      start: Point;
      screenStart: Point;
      selectionBefore: string[];
      additive: boolean;
    }
  | {
      type: 'move';
      start: Point;
      initial: Map<string, { x: number; y: number }>;
      /** Selected hierarchy roots whose parent can change during this drag. */
      rootIds: string[];
      /** Parent snapshots for live reparenting cancellation. */
      initialParents: Map<string, string | null>;
      /** Moving roots plus descendants: none may become its own drop target. */
      dropExclusions: Set<string>;
      lastReparentAt: number;
      bounds0: Bounds | null;
      selectionBefore: string[];
      axis: Axis | null;
      /** Container the dragged shapes live in, which scopes snap candidates. */
      ancestor: string | null;
      /** Gesture-start feature points, translated with the moving selection. */
      snapPoints0: Point[];
      /**
       * Snap candidates for this drag, filled on first use and reused for the
       * rest of the gesture — the same lifetime the resize/handle states
       * already give their `targets`. Rebuilding it per pointer sample meant an
       * R-tree query plus a `getShape` over every viewport shape on each one.
       * Lazy rather than captured at pointer-down so toggling snapping on
       * mid-drag still finds targets.
       */
      targets: BoundsSnapTarget[] | null;
    }
  | {
      type: 'resize';
      handle: ResizeHandleId;
      initial: Shape;
      util: ShapeUtil;
      /** Pointer offset from the handle's exact position when grabbed. */
      grabOffset: Point;
      targets: BoundsSnapTarget[];
      /** Descendant page positions used by normal (non-crop) frame resize. */
      frameChildren: Map<string, { x: number; y: number }> | null;
    }
  | {
      type: 'group-resize';
      handle: ResizeHandleId;
      /** Selection box at gesture start, in its own axis-aligned frame. */
      aligned0: Bounds;
      /** Shared rotation of the selection: the axes the scale runs along. */
      rotation: number;
      /**
       * How far the pointer sat from the handle's exact position when it was
       * grabbed, in the selection frame. Subtracting it keeps the box from
       * jumping to the cursor on the first move.
       */
      grabOffset: Point;
      items: GroupItem[];
      /**
       * Whether the selection can take a per-axis scale at all: false once any
       * member sits off the selection's axes or carries an intrinsic aspect
       * ratio, which pins the whole gesture to a uniform scale.
       */
      canDeform: boolean;
      targets: BoundsSnapTarget[];
    }
  | {
      type: 'rotate';
      items: RotationItem[];
      center: Point;
      startAngle: number;
      initialSharedRotation: number;
      current: Point;
      shiftKey: boolean;
      pointerType: string;
      completed: boolean;
    }
  | {
      type: 'handle';
      shapeId: string;
      handleId: string;
      util: ShapeUtil;
      initial: Shape;
      targets: PointSnapTarget[];
      canSnap: boolean;
    }
  | {
      type: 'marquee';
      start: Point;
      current: Point;
      selectionBefore: string[];
    };

/**
 * Topmost selectable shape under a world point, after an R-tree broad phase.
 *
 * Exported so the hover indicator can name the shape a click would land on
 * rather than answer the question a second time and risk a different answer.
 */
export function topmostHit(shapes: Shape[], p: Point, tol: number): string | null {
  return (
    hitTestCanvas(shapes, spatialIndex, p, tol, {
      zoom: useCameraStore.getState().camera.z,
      isEligible: isSelectable,
      isHidden: useHiddenStore.getState().isHidden,
    })?.id ?? null
  );
}

const OPPOSITE_HANDLE: Record<ResizeHandleId, ResizeHandleId> = {
  nw: 'se',
  n: 's',
  ne: 'sw',
  e: 'w',
  se: 'nw',
  s: 'n',
  sw: 'ne',
  w: 'e',
};

/**
 * Rotate about the page origin: the map between page space and the frame in
 * which an oriented selection box is axis-aligned.
 */
function rotateAboutOrigin(point: Point, angle: number): Point {
  if (!angle) return point;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: point.x * cos - point.y * sin,
    y: point.x * sin + point.y * cos,
  };
}

/** Where a handle sits on a box: a corner, or the midpoint of an edge. */
function handlePoint(bounds: Bounds, handle: ResizeHandleId): Point {
  return {
    x: handle.includes('w')
      ? bounds.minX
      : handle.includes('e')
        ? bounds.maxX
        : (bounds.minX + bounds.maxX) / 2,
    y: handle.includes('n')
      ? bounds.minY
      : handle.includes('s')
        ? bounds.maxY
        : (bounds.minY + bounds.maxY) / 2,
  };
}

/**
 * Where a resize pivots: the opposite handle, so the far edge stays put, or the
 * box's centre while Alt is held, so both edges travel and the middle holds.
 */
function resizeAnchor(
  b0: Bounds,
  handle: ResizeHandleId,
  fromCenter: boolean,
): Point {
  return fromCenter
    ? boundsCenter(b0)
    : handlePoint(b0, OPPOSITE_HANDLE[handle]);
}

/**
 * Scale factors for dragging `handle` to `pointer`, both given in the box's own
 * frame, about `anchor`. An edge handle has no extent along its other axis,
 * which falls out of the division as leaving that axis alone; locking the
 * aspect ratio lets whichever axis moved further drive both, keeping each one's
 * sign.
 *
 * A factor is free to go negative. A handle dragged past its anchor turns the
 * box inside out, which is a mirror rather than a collapse — the caller
 * straightens the box and mirrors the shape's own geometry to match.
 */
function resizeScale(
  b0: Bounds,
  handle: ResizeHandleId,
  pointer: Point,
  lockAspect: boolean,
  anchor: Point,
): { sx: number; sy: number } {
  const start = handlePoint(b0, handle);
  const dx0 = start.x - anchor.x;
  const dy0 = start.y - anchor.y;
  let sx = dx0 === 0 ? 1 : (pointer.x - anchor.x) / dx0;
  let sy = dy0 === 0 ? 1 : (pointer.y - anchor.y) / dy0;
  const xLocked = handle === 'n' || handle === 's';
  const yLocked = handle === 'e' || handle === 'w';
  if (lockAspect) {
    if (yLocked) sy = Math.abs(sx);
    else if (xLocked) sx = Math.abs(sy);
    else if (Math.abs(sx) > Math.abs(sy)) sy = Math.abs(sx) * (sy < 0 ? -1 : 1);
    else sx = Math.abs(sy) * (sx < 0 ? -1 : 1);
  } else {
    // An edge handle drives one axis only, whatever the pointer did on the
    // other — the division above already says so, except when the anchor is
    // the centre and both offsets are nonzero.
    if (xLocked) sx = 1;
    if (yLocked) sy = 1;
  }
  return { sx, sy };
}

/**
 * `bounds` with its sides in order and no thinner than `MIN_RESIZE` on either
 * axis. A negative scale puts the sides the wrong way round; a shape has no way
 * to hold an inverted box, so the mirror is carried by its own geometry and the
 * box itself is straightened here.
 */
function normalizedBounds(bounds: Bounds): Bounds {
  const minX = Math.min(bounds.minX, bounds.maxX);
  const minY = Math.min(bounds.minY, bounds.maxY);
  return {
    minX,
    minY,
    maxX: Math.max(bounds.minX, bounds.maxX, minX + MIN_RESIZE),
    maxY: Math.max(bounds.minY, bounds.maxY, minY + MIN_RESIZE),
  };
}

/** The handle each of the eight becomes under a mirror in x, and in y. */
const MIRROR_X_HANDLE: Record<ResizeHandleId, ResizeHandleId> = {
  nw: 'ne',
  n: 'n',
  ne: 'nw',
  e: 'w',
  se: 'sw',
  s: 's',
  sw: 'se',
  w: 'e',
};
const MIRROR_Y_HANDLE: Record<ResizeHandleId, ResizeHandleId> = {
  nw: 'sw',
  n: 's',
  ne: 'se',
  e: 'e',
  se: 'ne',
  s: 'n',
  sw: 'nw',
  w: 'w',
};

/**
 * The handle a drag is now holding, once it has turned the box inside out on
 * the axes given. The name is what the cursor and the bounds snapper read: an
 * `se` grip pushed past its anchor in x is dragging the box's `sw` corner, and
 * both of them have to follow it there.
 */
function flippedHandle(
  handle: ResizeHandleId,
  flipX: boolean,
  flipY: boolean,
): ResizeHandleId {
  const afterX = flipX ? MIRROR_X_HANDLE[handle] : handle;
  return flipY ? MIRROR_Y_HANDLE[afterX] : afterX;
}

/**
 * Shapes carrying an intrinsic aspect ratio, which scaling their axes apart
 * would distort: typeset content and artwork read rather than drawn. Their
 * resize is uniform whether or not Shift is held, and one of them anywhere in a
 * multi-selection makes that whole gesture uniform too.
 */
function isAspectRatioLocked(shape: Shape): boolean {
  return (
    shape.type === 'text' ||
    shape.type === 'equation' ||
    shape.type === 'sticker'
  );
}

/**
 * Whether a resize of `handle` keeps the aspect ratio. Text is the exception to
 * every other rule: its left and right handles set a wrap width and are never
 * uniform, not even under Shift, and every other handle on it always is.
 */
function resizeLocksAspect(
  shape: Shape,
  handle: ResizeHandleId,
  shiftKey: boolean,
): boolean {
  if (shape.type === 'text') return !(handle === 'e' || handle === 'w');
  return shiftKey || isAspectRatioLocked(shape);
}

/** The shape a flipped resize fits into its new box: `initial`, mirrored once
 *  per axis the drag turned inside out. */
function mirroredInitial(
  initial: Shape,
  flipX: boolean,
  flipY: boolean,
): Shape {
  let shape = initial;
  if (flipX) shape = mirrorShapeLocally(shape, true);
  if (flipY) shape = mirrorShapeLocally(shape, false);
  return shape;
}

function scaleBounds(
  b0: Bounds,
  anchor: Point,
  sx: number,
  sy: number,
): Bounds {
  return {
    minX: anchor.x + (b0.minX - anchor.x) * sx,
    maxX: anchor.x + (b0.maxX - anchor.x) * sx,
    minY: anchor.y + (b0.minY - anchor.y) * sy,
    maxY: anchor.y + (b0.maxY - anchor.y) * sy,
  };
}

/**
 * Quarter turns from `axis` to `rotation`, or null when the two are not a
 * multiple of 90° apart. Only shapes square to the selection axis can take a
 * per-axis scale; anything else would have to shear to follow the box.
 */
function quarterTurnsFrom(rotation: number, axis: number): number | null {
  const turns = (rotation - axis) / (Math.PI / 2);
  const nearest = Math.round(turns);
  if (Math.abs(turns - nearest) > 1e-6) return null;
  return ((nearest % 4) + 4) % 4;
}

/**
 * `bounds` moved so the gesture's anchor holds the place it is drawn in. The
 * anchor is a fixed point of the scale, so it keeps its coordinates in the
 * box's own frame — but the box turns about its centre, and that centre has
 * moved, so on a rotated shape the anchor's page position has to be put back.
 */
function anchoredBounds(
  bounds: Bounds,
  anchor: Point,
  center0: Point,
  rotation0: number,
  rotation1: number,
): Bounds {
  if (!rotation0 && !rotation1) return bounds;
  const before = rotatePoint(anchor, center0, rotation0);
  const after = rotatePoint(anchor, boundsCenter(bounds), rotation1);
  const dx = before.x - after.x;
  const dy = before.y - after.y;
  return {
    minX: bounds.minX + dx,
    minY: bounds.minY + dy,
    maxX: bounds.maxX + dx,
    maxY: bounds.maxY + dy,
  };
}

interface ResizeResult {
  /** `initial`, mirrored on whichever axes the drag turned inside out. Its
   *  rotation can differ from `initial`'s — see `mirrorShapeLocally`. */
  shape: Shape;
  /** New unrotated world bounds, corrected for the shape's rotation. */
  bounds: Bounds;
  /** The anchor, in the box's own frame: where a re-centre has to put it. */
  anchor: Point;
  flipX: boolean;
  flipY: boolean;
}

/** Resolve one pointer sample of a single-shape resize. */
function computeResize(
  initial: Shape,
  util: ShapeUtil,
  handle: ResizeHandleId,
  pointer: Point,
  lockAspect: boolean,
  fromCenter: boolean,
): ResizeResult {
  const b0 = util.getBounds(initial as never);
  const c0 = boundsCenter(b0);
  const localPointer = initial.rotation
    ? rotatePoint(pointer, c0, -initial.rotation)
    : pointer;
  const anchor = resizeAnchor(b0, handle, fromCenter);
  const { sx, sy } = resizeScale(b0, handle, localPointer, lockAspect, anchor);
  const shape = mirroredInitial(initial, sx < 0, sy < 0);
  return {
    shape,
    bounds: anchoredBounds(
      normalizedBounds(scaleBounds(b0, anchor, sx, sy)),
      anchor,
      c0,
      initial.rotation,
      shape.rotation,
    ),
    anchor,
    flipX: sx < 0,
    flipY: sy < 0,
  };
}

/** `bounds` re-centred on `center`, keeping the larger half-extent it grew to.
 *  A centre-anchored resize is snapped by its dragged edge like any other, and
 *  this puts the box back around the point it was told to hold. */
function recenteredBounds(bounds: Bounds, center: Point): Bounds {
  const hw = Math.max(bounds.maxX - center.x, center.x - bounds.minX);
  const hh = Math.max(bounds.maxY - center.y, center.y - bounds.minY);
  return {
    minX: center.x - hw,
    maxX: center.x + hw,
    minY: center.y - hh,
    maxY: center.y + hh,
  };
}

function hasCrossedDragSlop(start: Point, point: Point): boolean {
  return distance(start, point) >= DRAG_SLOP_SCREEN;
}

function marqueeBounds(start: Point, point: Point): Bounds {
  return {
    minX: Math.min(start.x, point.x),
    minY: Math.min(start.y, point.y),
    maxX: Math.max(start.x, point.x),
    maxY: Math.max(start.y, point.y),
  };
}

/** The modifiers a marquee reads; pointer samples and key events both carry them. */
type MarqueeKeys = Pick<ToolPointerInfo, 'shiftKey' | 'ctrlKey' | 'metaKey'>;

function marqueeMode(ctrlKey: boolean, metaKey: boolean): MarqueeMode {
  return ctrlKey || metaKey ? 'wrap' : 'intersect';
}

/**
 * Whether this pointer sample of a resize snaps. Command/Ctrl inverts the
 * board's own setting rather than only turning snapping off, so the modifier
 * reaches snapping from either side — and Alt is left to mean one thing,
 * resizing about the centre.
 */
function shouldSnapResize(info: ToolPointerInfo): boolean {
  const enabled = useCanvasUiStore.getState().snappingEnabled;
  return info.metaKey || info.ctrlKey ? !enabled : enabled;
}

function normalizeRotation(angle: number): number {
  return ((angle % TAU) + TAU) % TAU;
}

function effectiveRotation(
  target: number,
  shiftKey: boolean,
  pointerType: string,
  complete: boolean,
): number {
  let rotation = shiftKey
    ? snapAngle(target, Math.round(TAU / ROTATE_SNAP))
    : complete
      ? snapAngle(target, Math.round(TAU / ONE_DEGREE))
      : target;
  if (pointerType === 'touch') {
    const rightAngle = snapAngle(rotation, Math.round(TAU / RIGHT_ANGLE_SNAP));
    if (
      Math.abs(shortAngleDist(rotation, rightAngle)) < COARSE_ROTATE_TOLERANCE
    ) {
      rotation = rightAngle;
    }
  }
  return rotation;
}

/**
 * The shapes a rotation gesture turns: the selection plus the descendants that
 * follow it, minus groups (which hold no rotation of their own) and any
 * explicitly selected shape that is locked.
 */
function rotationItems(
  shapes: Shape[],
  selectionInfo: SelectionInfo,
  editor: Editor,
): RotationItem[] {
  const items: RotationItem[] = [];
  const explicit = new Set(selectionInfo.ids);
  for (const id of moveTargetIds(shapes, selectionInfo.ids)) {
    const initial = editor.getShape(id);
    if (
      !initial ||
      (initial.locked && explicit.has(initial.id)) ||
      initial.type === 'group'
    ) {
      continue;
    }
    const util = shapeRegistry.getFor(initial);
    if (!util) continue;
    items.push({
      initial,
      center: boundsCenter(util.getBounds(initial as never)),
    });
  }
  return items;
}

/**
 * Frames a finished rotation may have swung a child clear of: every frame
 * ancestor of a rotated shape, minus the frames that turned themselves — their
 * children rode along, so they still overlap.
 */
function kickoutRotatedFrameChildren(
  items: RotationItem[],
  editor: Editor,
): void {
  const rotated = new Set(items.map((item) => item.initial.id));
  const frames = new Set<string>();
  const seen = new Set<string>();
  for (const item of items) {
    let parentId = item.initial.parentId;
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = editor.getShape(parentId);
      if (!parent) break;
      if (parent.type === 'frame' && !rotated.has(parent.id)) {
        frames.add(parent.id);
      }
      parentId = parent.parentId;
    }
  }
  for (const id of frames) kickoutOccludedFrameChildren(editor, id);
}

function rotateState(
  selectionInfo: SelectionInfo,
  info: ToolPointerInfo,
  items: RotationItem[],
): Extract<SelectState, { type: 'rotate' }> {
  return {
    type: 'rotate',
    items,
    center: selectionInfo.center,
    startAngle: Math.atan2(
      info.point.y - selectionInfo.center.y,
      info.point.x - selectionInfo.center.x,
    ),
    initialSharedRotation: selectionInfo.rotation,
    current: info.point,
    shiftKey: info.shiftKey,
    pointerType: info.pointerType,
    completed: false,
  };
}

export function createSelectTool(): Tool {
  let state: SelectState = { type: 'idle' };
  /**
   * The last pointer sample of the gesture in progress. Shift, Alt and
   * Command all change what a resize means, so pressing or releasing one has
   * to re-resolve the drag from where the pointer already is rather than
   * waiting for it to move again.
   */
  let lastMove: ToolPointerInfo | null = null;

  function applyRotation(
    rotate: Extract<SelectState, { type: 'rotate' }>,
    point: Point,
    shiftKey: boolean,
    pointerType: string,
    complete: boolean,
    ctx: ToolContext,
  ): void {
    rotate.current = point;
    rotate.shiftKey = shiftKey;
    rotate.pointerType = pointerType;
    rotate.completed = complete;
    const pointerAngle = Math.atan2(
      point.y - rotate.center.y,
      point.x - rotate.center.x,
    );
    const target = effectiveRotation(
      rotate.initialSharedRotation + pointerAngle - rotate.startAngle,
      shiftKey,
      pointerType,
      complete,
    );
    const delta = target - rotate.initialSharedRotation;
    ctx.editor.transact(() => {
      for (const item of rotate.items) {
        const nextCenter = rotatePoint(item.center, rotate.center, delta);
        ctx.editor.updateShape(item.initial.id, {
          x: item.initial.x + nextCenter.x - item.center.x,
          y: item.initial.y + nextCenter.y - item.center.y,
          rotation: normalizeRotation(item.initial.rotation + delta),
        });
      }
    });
  }

  function createMoveState(
    start: Point,
    selectionBefore: string[],
    editor: Editor,
  ): Extract<SelectState, { type: 'move' }> {
    // Expand selection to the shapes that actually move (group → descendants,
    // frame → frame + descendants, leaf → itself).
    const shapes = editor.getShapes();
    const selectedIds = useSelectionStore.getState().selectedIds;
    const rootIds = selectionRoots(editor, selectedIds);
    const ids = moveTargetIds(shapes, selectedIds);
    const initial = new Map<string, { x: number; y: number }>();
    let bounds0: Bounds | null = null;
    for (const id of ids) {
      const shape = editor.getShape(id);
      // An explicitly selected locked root stays put. A locked descendant still
      // follows an unlocked container, matching a real local transform tree.
      if (!shape || (shape.locked && rootIds.includes(shape.id))) continue;
      initial.set(id, { x: shape.x, y: shape.y });
      const bounds = shapeRotatedBounds(shape);
      bounds0 = bounds0
        ? {
            minX: Math.min(bounds0.minX, bounds.minX),
            minY: Math.min(bounds0.minY, bounds.minY),
            maxX: Math.max(bounds0.maxX, bounds.maxX),
            maxY: Math.max(bounds0.maxY, bounds.maxY),
          }
        : bounds;
    }
    const selectionInfo = getSelectionInfo(
      shapes,
      selectedIds,
      1,
      editor.getShape,
    );
    const selectionCanMove = selectedIds.every(
      (id) => !editor.getShape(id)?.locked,
    );
    const snapPoints0 =
      selectionInfo && selectionCanMove
        ? [
            selectionInfo.corners.nw,
            selectionInfo.corners.ne,
            selectionInfo.corners.se,
            selectionInfo.corners.sw,
            selectionInfo.center,
          ]
        : bounds0
          ? boundsSnapPoints(bounds0)
          : [];
    return {
      type: 'move',
      start,
      initial,
      rootIds,
      initialParents: new Map(
        rootIds.map((id) => [id, editor.getShape(id)?.parentId ?? null]),
      ),
      dropExclusions: movingSubtreeIds(shapes, rootIds),
      lastReparentAt: -Infinity,
      bounds0,
      selectionBefore,
      axis: null,
      // From the selection itself, not the expanded move set: a selected group
      // is scoped by the group's own container, not by the group.
      ancestor: findCommonAncestor(editor.getShape, selectedIds),
      snapPoints0,
      targets: null,
    };
  }

  function applyMove(
    move: Extract<SelectState, { type: 'move' }>,
    info: ToolPointerInfo,
    ctx: ToolContext,
  ): void {
    const rawDx = info.point.x - move.start.x;
    const rawDy = info.point.y - move.start.y;
    if (!info.shiftKey) move.axis = null;
    else if (!move.axis)
      move.axis = Math.abs(rawDx) >= Math.abs(rawDy) ? 'x' : 'y';

    let dx = move.axis === 'y' ? 0 : rawDx;
    let dy = move.axis === 'x' ? 0 : rawDy;
    if (
      useCanvasUiStore.getState().snappingEnabled &&
      !info.altKey &&
      move.bounds0
    ) {
      const camera = useCameraStore.getState().camera;
      const threshold = SNAP_SCREEN / camera.z;
      const moving: Bounds = {
        minX: move.bounds0.minX + dx,
        minY: move.bounds0.minY + dy,
        maxX: move.bounds0.maxX + dx,
        maxY: move.bounds0.maxY + dy,
      };
      const background = useCanvasUiStore.getState().background;
      move.targets ??= snapTargetBounds(
        ctx.editor,
        new Set(move.initial.keys()),
        move.ancestor,
        snapRegion(ctx, {
          minX: moving.minX - threshold,
          minY: moving.minY - threshold,
          maxX: moving.maxX + threshold,
          maxY: moving.maxY + threshold,
        }),
      );
      const snap = snapBounds(
        moving,
        move.targets,
        info.metaKey || info.ctrlKey
          ? null
          : getSnapGridStep(background, camera),
        threshold,
        {
          points: move.snapPoints0.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          })),
          axis: move.axis,
        },
      );
      if (move.axis !== 'y') dx += snap.dx;
      if (move.axis !== 'x') dy += snap.dy;
      useSelectionStore
        .getState()
        .setSnapGuides(
          snap.guides.filter((guide) =>
            move.axis === 'x'
              ? guide.axis === 'x'
              : move.axis === 'y'
                ? guide.axis === 'y'
                : true,
          ),
        );
    } else {
      useSelectionStore.getState().setSnapGuides([]);
    }
    ctx.editor.transact(() => {
      for (const [id, initial] of move.initial) {
        ctx.editor.updateShape(id, { x: initial.x + dx, y: initial.y + dy });
      }
    });
    // Parenting follows the gesture while it is visible, so clipping and nested
    // stacking preview immediately rather than jumping only on pointer-up.
    reparentMovedRoots(move, ctx);
  }

  function intersectsAncestorMasks(
    shape: Shape,
    bounds: Bounds,
    editor: Editor,
  ): boolean {
    if (shape.type === 'arrow') return true;
    let current: Shape | undefined = shape;
    const visited = new Set<string>();
    while (current?.parentId && !visited.has(current.id)) {
      visited.add(current.id);
      const parent = editor.getShape(current.parentId);
      if (!parent) break;
      if (
        parent.type === 'frame' &&
        !marqueeIntersectsMask(parent, bounds)
      ) {
        return false;
      }
      current = parent;
    }
    return true;
  }

  function selectMarquee(
    bounds: Bounds,
    mode: MarqueeMode,
    additive: boolean,
    selectionBefore: string[],
    editor: Editor,
  ): void {
    const entered = useEnteredGroupStore.getState().enteredGroupId;
    const found = new Set<string>();
    const containingGroups = new Set<string>();

    // Iterate the R-tree result directly: filtering the whole document after
    // the broad phase would still make every pointer frame O(N).
    for (const id of spatialIndex.search(bounds)) {
      const shape = editor.getShape(id);
      if (!shape || !isSelectable(shape)) continue;
      if (!matchesMarquee(shape, bounds, mode)) continue;
      if (!intersectsAncestorMasks(shape, bounds, editor)) continue;
      const target = selectionTargetId(editor.getShape, shape.id, entered);
      if (editor.getShape(target)?.type === 'group' && mode === 'wrap') {
        containingGroups.add(target);
      } else {
        found.add(target);
      }
    }

    if (containingGroups.size > 0) {
      const shapes = editor.getShapes();
      for (const groupId of containingGroups) {
        const leaves = leafDescendants(shapes, groupId).filter(isSelectable);
        if (
          leaves.length > 0 &&
          leaves.every(
            (shape) =>
              matchesMarquee(shape, bounds, mode) &&
              intersectsAncestorMasks(shape, bounds, editor),
          )
        ) {
          found.add(groupId);
        }
      }
    }

    useSelectionStore
      .getState()
      .setSelection(
        additive ? [...new Set([...selectionBefore, ...found])] : [...found],
      );
  }

  /**
   * Re-select from the marquee's rectangle and the modifiers held right now:
   * Shift adds to the prior selection, Ctrl/Command switches to wrap.
   */
  function updateMarquee(
    marquee: Extract<SelectState, { type: 'marquee' }>,
    point: Point,
    keys: MarqueeKeys,
    editor: Editor,
  ): void {
    const bounds = marqueeBounds(marquee.start, point);
    const mode = marqueeMode(keys.ctrlKey, keys.metaKey);
    marquee.current = point;
    useSelectionStore.getState().setMarquee({ bounds, mode });
    selectMarquee(
      bounds,
      mode,
      keys.shiftKey,
      marquee.selectionBefore,
      editor,
    );
  }

  /** Re-test a live marquee when a selection modifier is pressed or released. */
  function reapplyMarqueeModifiers(
    event: KeyboardEvent,
    ctx: ToolContext,
  ): boolean {
    if (
      state.type !== 'marquee' ||
      (event.key !== 'Shift' && event.key !== 'Control' && event.key !== 'Meta')
    ) {
      return false;
    }
    updateMarquee(state, state.current, event, ctx.editor);
    return true;
  }

  function reparentMovedRoots(
    move: Extract<SelectState, { type: 'move' }>,
    ctx: ToolContext,
    force = false,
  ): void {
    const now = Date.now();
    if (!force && now - move.lastReparentAt < 60) return;
    move.lastReparentAt = now;
    const shapes = ctx.editor.getShapes();
    const updates: Array<{ id: string; parentId: string | null }> = [];
    for (const id of move.rootIds) {
      const shape = ctx.editor.getShape(id);
      if (!shape || shape.locked) continue;
      const parent = shape.parentId
        ? ctx.editor.getShape(shape.parentId)
        : null;
      // Entering a group permits moving one of its members, but never silently
      // dissolves the explicit group relationship. Groups and frames themselves
      // remain eligible to move between frames.
      if (parent?.type === 'group') continue;
      // Bound arrows choose their closest common container in the routing pass.
      if (
        shape.type === 'arrow' &&
        (shape.props.bindings?.start || shape.props.bindings?.end)
      ) {
        continue;
      }
      const nextParentId =
        topFrameOverlappingShape(shapes, shape, move.dropExclusions)?.id ??
        null;
      if ((shape.parentId ?? null) !== (nextParentId ?? null)) {
        updates.push({ id, parentId: nextParentId });
      }
    }
    if (!updates.length) return;
    ctx.editor.transact(() => {
      for (const update of updates) {
        ctx.editor.updateShape(update.id, { parentId: update.parentId });
      }
    });
  }

  function clearTransientState(): void {
    useSelectionStore.getState().setMarquee(null);
    useSelectionStore.getState().setSnapGuides([]);
    useSelectionStore.getState().setGestureCursor(null);
  }

  // Finish the gesture, keeping its result. The live drag already wrote the
  // moved/resized/rotated transform to the document during onPointerMove, so
  // this only runs the post-gesture bookkeeping. Shared by pointer-up and
  // commit (the OS reclaimed the pointer mid-gesture).
  function commit(ctx: ToolContext): void {
    const finished = state;
    if (finished.type === 'rotate' && !finished.completed) {
      applyRotation(
        finished,
        finished.current,
        finished.shiftKey,
        finished.pointerType,
        true,
        ctx,
      );
    }
    if (finished.type === 'pending-shape') {
      if (finished.additive) {
        useSelectionStore.getState().toggle(finished.targetId);
      }
    } else if (finished.type === 'pending-empty') {
      if (!finished.additive) useSelectionStore.getState().clear();
    } else if (finished.type === 'move') {
      reparentMovedRoots(finished, ctx, true);
    } else if (
      finished.type === 'resize' &&
      finished.initial.type === 'frame'
    ) {
      kickoutOccludedFrameChildren(ctx.editor, finished.initial.id);
    } else if (finished.type === 'rotate') {
      kickoutRotatedFrameChildren(finished.items, ctx.editor);
    }
    clearTransientState();
    state = { type: 'idle' };
  }

  /**
   * Re-run the drag from the pointer where it already is, because a modifier
   * key changed what it means. Only the resize states need it: rotation reads
   * Shift through `applyRotation` below, and a marquee re-selects directly.
   */
  function reapplyModifiers(event: KeyboardEvent, ctx: ToolContext): boolean {
    if (state.type !== 'resize' && state.type !== 'group-resize') return false;
    if (!lastMove) return false;
    tool.onPointerMove?.(
      {
        ...lastMove,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
      },
      ctx,
    );
    return true;
  }

  const tool: Tool = {
    id: 'select',
    label: 'Select',
    hotkey: 'v',
    cursor: 'default',
    icon: LassoGlyph,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const zoom = useCameraStore.getState().camera.z;
      const selection = useSelectionStore.getState();
      const shapes = ctx.editor.getShapes();
      const selectionInfo = getSelectionInfo(
        shapes,
        selection.selectedIds,
        zoom,
        ctx.editor.getShape,
        isCoarsePointer(),
      );

      // 1a. Custom shape handles (connector endpoints/bend) take priority.
      if (selectionInfo?.isSingle && selectionInfo.customHandles) {
        for (const handle of selectionInfo.customHandles) {
          if (distance(info.point, handle.point) > HANDLE_HIT_SCREEN / zoom)
            continue;
          const shape = ctx.editor.getShape(selectionInfo.ids[0]!);
          const util = shape ? shapeRegistry.getFor(shape) : undefined;
          if (shape && util?.onHandleDrag) {
            const targets: PointSnapTarget[] = snapTargetShapes(
              ctx.editor,
              new Set([shape.id]),
              shape.parentId ?? null,
              snapRegion(ctx, selectionInfo.bounds),
            ).flatMap((target) => {
              const geometry = shapeSnapGeometry(target);
              return geometry ? [{ ...geometry, shapeId: target.id }] : [];
            });
            // The shape's own far ends, snapshotted before the drag mutates it.
            const self = selfSnapTarget(shape, handle.id);
            if (self) targets.push(self);
            state = {
              type: 'handle',
              shapeId: shape.id,
              handleId: handle.id,
              util,
              initial: shape,
              targets,
              canSnap: handle.kind === 'vertex',
            };
            if (handle.kind === 'create') {
              const result = util.onHandleDrag(
                shape as never,
                handle.id,
                handle.point,
                { shiftKey: false },
              );
              if (result.props) {
                ctx.editor.updateShape(shape.id, {
                  props: result.props as unknown as Record<string, unknown>,
                });
              }
            }
            return;
          }
        }
      }

      // 1b. Generic resize handles (single or group bounding box).
      if (selectionInfo) {
        const hitHandle = hitSelectionHandle(selectionInfo, info.point);
        const handle = hitHandle
          ? selectionInfo.handles.find(
              (candidate) => candidate.id === hitHandle,
            )!
          : null;
        if (handle) {
          if (selectionInfo.isSingle) {
            const initial = ctx.editor.getShape(selectionInfo.ids[0]!);
            const util = initial ? shapeRegistry.getFor(initial) : undefined;
            if (initial && util?.canResize) {
              const movingIds = new Set(
                moveTargetIds(shapes, selectionInfo.ids),
              );
              state = {
                type: 'resize',
                handle: handle.id,
                initial,
                util,
                grabOffset: {
                  x: info.point.x - handle.point.x,
                  y: info.point.y - handle.point.y,
                },
                frameChildren:
                  initial.type === 'frame'
                    ? new Map(
                        descendantsOf(shapes, initial.id).map((child) => [
                          child.id,
                          { x: child.x, y: child.y },
                        ]),
                      )
                    : null,
                targets: snapTargetBounds(
                  ctx.editor,
                  movingIds,
                  initial.parentId ?? null,
                  snapRegion(ctx, selectionInfo.bounds),
                ),
              };
            }
          } else {
            const items: GroupItem[] = [];
            for (const id of selectionInfo.ids) {
              const shape = ctx.editor.getShape(id);
              if (!shape || shape.locked) continue;
              const util = shapeRegistry.getFor(shape);
              if (util?.canResize) {
                const b0 = util.getBounds(shape as never);
                items.push({
                  initial: shape,
                  util,
                  b0,
                  center0: boundsCenter(b0),
                  quarterTurns: quarterTurnsFrom(
                    shape.rotation,
                    selectionInfo.rotation,
                  ),
                });
              }
            }
            if (items.length) {
              const movingIds = new Set(
                moveTargetIds(shapes, selectionInfo.ids),
              );
              const aligned0 = selectionInfo.alignedBounds;
              const grabbed = rotateAboutOrigin(
                info.point,
                -selectionInfo.rotation,
              );
              const on = handlePoint(aligned0, handle.id);
              state = {
                type: 'group-resize',
                handle: handle.id,
                aligned0,
                rotation: selectionInfo.rotation,
                grabOffset: { x: grabbed.x - on.x, y: grabbed.y - on.y },
                items,
                canDeform: items.every(
                  (item) =>
                    item.quarterTurns !== null &&
                    !isAspectRatioLocked(item.initial),
                ),
                targets: snapTargetBounds(
                  ctx.editor,
                  movingIds,
                  findCommonAncestor(ctx.editor.getShape, selectionInfo.ids),
                  snapRegion(ctx, selectionInfo.bounds),
                ),
              };
            }
          }
          // Held for the whole drag: the pointer leaves the handle immediately,
          // so without this the cursor snaps back to the tool's own the moment
          // the resize it is describing actually begins.
          if (state?.type === 'resize' || state?.type === 'group-resize') {
            useSelectionStore
              .getState()
              .setGestureCursor(resizeCursor(handle.id, selectionInfo.rotation));
          }
          return;
        }

        // Rotation is a single knob off an edge, tested after the resize
        // handles so a corner or edge always resizes.
        const knob = selectionInfo.rotateHandle;
        if (knob && distance(info.point, knob.point) <= knob.radius) {
          const items = rotationItems(shapes, selectionInfo, ctx.editor);
          if (items.length) {
            state = rotateState(selectionInfo, info, items);
            useSelectionStore.getState().setGestureCursor('grabbing');
          }
          return;
        }
      }

      // 2. A shape under the pointer resolves to its outer group unless entered.
      const hitLeaf = topmostHit(shapes, info.point, SHAPE_HIT_SCREEN / zoom);
      if (hitLeaf) {
        const targetId = selectionTargetId(
          ctx.editor.getShape,
          hitLeaf,
          useEnteredGroupStore.getState().enteredGroupId,
        );
        const selectionBefore = [...selection.selectedIds];
        const targetWasSelected = selectionBefore.includes(targetId);
        if (!info.shiftKey && !targetWasSelected) {
          selection.setSelection([targetId]);
        }
        state = {
          type: 'pending-shape',
          start: info.point,
          screenStart: info.screenPoint,
          targetId,
          selectionBefore,
          targetWasSelected,
          additive: info.shiftKey,
        };
        return;
      }

      // 3. Empty space inside the selection box can drag that selection: a
      // multi-selection, or a selected group. A group is a *single* selection
      // whose box is derived from its children, so without the group case a
      // click in the gap between two of its strokes would fall through to the
      // marquee below and deselect it — the whole group has to be draggable
      // from anywhere inside its box, not just from a child's ink. Any shape
      // actually under the pointer still wins, because step 2 runs first.
      const singleGroupSelected =
        selectionInfo?.isSingle &&
        ctx.editor.getShape(selectionInfo.ids[0]!)?.type === 'group';
      if (
        !info.shiftKey &&
        selectionInfo &&
        (!selectionInfo.isSingle || singleGroupSelected) &&
        boundsContainsPoint(selectionInfo.bounds, info.point)
      ) {
        state = {
          type: 'pending-selection',
          start: info.point,
          screenStart: info.screenPoint,
          selectionBefore: [...selection.selectedIds],
        };
        return;
      }

      // 4. Empty canvas becomes a marquee only after the pointer crosses slop.
      useEnteredGroupStore.getState().exit();
      state = {
        type: 'pending-empty',
        start: info.point,
        screenStart: info.screenPoint,
        selectionBefore: [...selection.selectedIds],
        additive: info.shiftKey,
      };
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      lastMove = info;
      switch (state.type) {
        case 'idle':
          return;
        case 'pending-shape': {
          if (!hasCrossedDragSlop(state.screenStart, info.screenPoint)) return;
          if (state.additive && !state.targetWasSelected) {
            useSelectionStore
              .getState()
              .setSelection([
                ...new Set([...state.selectionBefore, state.targetId]),
              ]);
          }
          const move = createMoveState(
            state.start,
            state.selectionBefore,
            ctx.editor,
          );
          state = move;
          applyMove(move, info, ctx);
          return;
        }
        case 'pending-selection': {
          if (!hasCrossedDragSlop(state.screenStart, info.screenPoint)) return;
          const move = createMoveState(
            state.start,
            state.selectionBefore,
            ctx.editor,
          );
          state = move;
          applyMove(move, info, ctx);
          return;
        }
        case 'pending-empty': {
          if (!hasCrossedDragSlop(state.screenStart, info.screenPoint)) return;
          state = {
            type: 'marquee',
            start: state.start,
            current: info.point,
            selectionBefore: state.selectionBefore,
          };
          // Evaluate on the first drag sample rather than waiting for another move.
          updateMarquee(state, info.point, info, ctx.editor);
          return;
        }
        case 'move':
          applyMove(state, info, ctx);
          return;
        case 'resize': {
          const lockAspect = resizeLocksAspect(
            state.initial,
            state.handle,
            info.shiftKey,
          );
          const fromCenter = info.altKey;
          const resolved = computeResize(
            state.initial,
            state.util,
            state.handle,
            {
              x: info.point.x - state.grabOffset.x,
              y: info.point.y - state.grabOffset.y,
            },
            lockAspect,
            fromCenter,
          );
          let bounds = resolved.bounds;
          // The cursor names the handle the drag is holding *now*, which a flip
          // has moved to the other side of the box.
          useSelectionStore
            .getState()
            .setGestureCursor(
              resizeCursor(
                flippedHandle(state.handle, resolved.flipX, resolved.flipY),
                state.initial.rotation,
              ),
            );
          if (shouldSnapResize(info)) {
            const camera = useCameraStore.getState().camera;
            const background = useCanvasUiStore.getState().background;
            const initialBounds = state.util.getBounds(state.initial as never);
            const snapped = snapResizeBounds(
              bounds,
              flippedHandle(state.handle, resolved.flipX, resolved.flipY),
              state.targets,
              getSnapGridStep(background, camera),
              SNAP_SCREEN / camera.z,
              lockAspect,
              (initialBounds.maxX - initialBounds.minX) /
                (initialBounds.maxY - initialBounds.minY || 1),
            );
            bounds = snapped.bounds;
            useSelectionStore.getState().setSnapGuides(snapped.guides);
          } else {
            useSelectionStore.getState().setSnapGuides([]);
          }
          // The snapper moves the dragged edge alone, which would walk a
          // centre-anchored box off the point it was told to hold.
          if (fromCenter) bounds = recenteredBounds(bounds, resolved.anchor);
          if (
            state.initial.type === 'text' &&
            (state.handle === 'e' || state.handle === 'w')
          ) {
            const props = {
              ...state.initial.props,
              sizingMode: 'fixed' as const,
              width: Math.max(MIN_TEXT_WIDTH, bounds.maxX - bounds.minX),
            };
            const nextLayout = layoutTextProps(props);
            const targetCenterY = (bounds.minY + bounds.maxY) / 2;
            ctx.editor.updateShape(state.initial.id, {
              x: bounds.minX,
              // Width reflow owns height. Centering the new dynamic height on
              // the drag box preserves the stationary side handle's pivot,
              // including when the text shape is rotated.
              y: targetCenterY - nextLayout.height / 2,
              props,
            });
            return;
          }
          const resized = state.util.resize(resolved.shape as never, bounds);
          // Only a shape whose local mirror *is* a half turn carries one, so
          // this is absent from almost every resize (see `mirrorShapeLocally`).
          const turned =
            resolved.shape.rotation === state.initial.rotation
              ? null
              : { rotation: resolved.shape.rotation };
          if (state.initial.type === 'frame' && state.frameChildren) {
            const initialFrame = state.initial;
            const frameChildren = state.frameChildren;
            const cropResize = info.metaKey || info.ctrlKey;
            const dx = resized.x - initialFrame.x;
            const dy = resized.y - initialFrame.y;
            ctx.editor.transact(() => {
              ctx.editor.updateShape(initialFrame.id, {
                x: resized.x,
                y: resized.y,
                ...turned,
                props: resized.props as unknown as Record<string, unknown>,
              });
              // Normal resize keeps child coordinates relative to the frame's
              // moving origin. Command/Ctrl switches to crop mode and pins page
              // positions instead; using gesture-start snapshots makes the
              // modifier fully reversible while the pointer is still down.
              for (const [id, initial] of frameChildren) {
                ctx.editor.updateShape(id, {
                  x: initial.x + (cropResize ? 0 : dx),
                  y: initial.y + (cropResize ? 0 : dy),
                });
              }
            });
          } else {
            ctx.editor.updateShape(state.initial.id, {
              x: resized.x,
              y: resized.y,
              ...turned,
              props: resized.props as unknown as Record<string, unknown>,
            });
          }
          return;
        }
        case 'group-resize': {
          // Work in the selection's own frame: an oriented box scales along the
          // axes it is drawn on, not the page's.
          const aligned = rotateAboutOrigin(info.point, -state.rotation);
          const pointer = {
            x: aligned.x - state.grabOffset.x,
            y: aligned.y - state.grabOffset.y,
          };
          // A shape sitting off the selection's axes cannot take a per-axis
          // scale without shearing, and neither can one carrying an intrinsic
          // aspect ratio — so one of either makes the whole gesture uniform,
          // rather than letting the rest of the selection deform around it.
          const lockAspect = info.shiftKey || !state.canDeform;
          const fromCenter = info.altKey;
          const anchor = resizeAnchor(state.aligned0, state.handle, fromCenter);
          const w0 = state.aligned0.maxX - state.aligned0.minX;
          const h0 = state.aligned0.maxY - state.aligned0.minY;
          let { sx, sy } = resizeScale(
            state.aligned0,
            state.handle,
            pointer,
            lockAspect,
            anchor,
          );
          const flipX = sx < 0;
          const flipY = sy < 0;
          useSelectionStore
            .getState()
            .setGestureCursor(
              resizeCursor(
                flippedHandle(state.handle, flipX, flipY),
                state.rotation,
              ),
            );
          // Alignment guides are page-axis features, so they only mean
          // something while the box still shares those axes.
          if (state.rotation === 0 && shouldSnapResize(info)) {
            const camera = useCameraStore.getState().camera;
            const background = useCanvasUiStore.getState().background;
            let box = normalizedBounds(
              scaleBounds(state.aligned0, anchor, sx, sy),
            );
            const snapped = snapResizeBounds(
              box,
              flippedHandle(state.handle, flipX, flipY),
              state.targets,
              getSnapGridStep(background, camera),
              SNAP_SCREEN / camera.z,
              lockAspect,
              w0 / (h0 || 1),
            );
            box = fromCenter
              ? recenteredBounds(snapped.bounds, anchor)
              : snapped.bounds;
            // Back to signed factors: the snap moved an edge, and the sign is
            // the flip the drag had already reached.
            sx = ((box.maxX - box.minX) / (w0 || 1)) * (flipX ? -1 : 1);
            sy = ((box.maxY - box.minY) / (h0 || 1)) * (flipY ? -1 : 1);
            useSelectionStore.getState().setSnapGuides(snapped.guides);
          } else {
            useSelectionStore.getState().setSnapGuides([]);
          }
          const items = state.items;
          const rotation = state.rotation;
          ctx.editor.transact(() => {
            for (const item of items) {
              const iw = item.b0.maxX - item.b0.minX;
              const ih = item.b0.maxY - item.b0.minY;
              // A shape turns about its own bounds centre, so that is the one
              // point the page frame and the shape's frame agree on: scale the
              // centre, then rebuild the box around it.
              const c = rotateAboutOrigin(item.center0, -rotation);
              const moved = rotateAboutOrigin(
                {
                  x: anchor.x + (c.x - anchor.x) * sx,
                  y: anchor.y + (c.y - anchor.y) * sy,
                },
                rotation,
              );
              const swapped =
                item.quarterTurns === 1 || item.quarterTurns === 3;
              // Off-axis shapes take the magnitude on both axes. The gesture is
              // already uniform whenever one of them is in the selection, so
              // this only picks which of two equal factors to read — and they
              // keep their orientation through a flip, because a mirror about
              // an axis that is not their own is not one they can hold.
              const off = item.quarterTurns === null;
              const w = off ? Math.abs(sx) : swapped ? sy : sx;
              const h = off ? Math.abs(sx) : swapped ? sx : sy;
              const scaled: Bounds = {
                minX: moved.x - (iw * Math.abs(w)) / 2,
                maxX: moved.x + (iw * Math.abs(w)) / 2,
                minY: moved.y - (ih * Math.abs(h)) / 2,
                maxY: moved.y + (ih * Math.abs(h)) / 2,
              };
              // A quarter turn swaps which of the selection's axes the shape's
              // own x runs along, so the mirror it takes swaps with it.
              const shape = off
                ? item.initial
                : mirroredInitial(
                    item.initial,
                    swapped ? flipY : flipX,
                    swapped ? flipX : flipY,
                  );
              const resized = item.util.resize(shape as never, scaled);
              ctx.editor.updateShape(item.initial.id, {
                x: resized.x,
                y: resized.y,
                ...(shape.rotation === item.initial.rotation
                  ? null
                  : { rotation: shape.rotation }),
                props: resized.props as unknown as Record<string, unknown>,
              });
            }
          });
          return;
        }
        case 'handle': {
          const shape = ctx.editor.getShape(state.shapeId);
          if (!shape || !state.util.onHandleDrag) return;
          let point = info.point;
          let bindingTarget: Shape | undefined;
          if (
            useCanvasUiStore.getState().snappingEnabled &&
            !info.altKey &&
            state.canSnap
          ) {
            const camera = useCameraStore.getState().camera;
            const snapped = snapPoint(
              point,
              state.targets,
              SNAP_SCREEN / camera.z,
            );
            point = snapped.point;
            bindingTarget = snapped.targetId
              ? ctx.editor.getShape(snapped.targetId)
              : undefined;
            if (
              !bindingTarget &&
              shape.type === 'arrow' &&
              (state.handleId === 'start' || state.handleId === 'end')
            ) {
              bindingTarget =
                findBindableShapeAt(
                  ctx.editor.getShapes(),
                  point,
                  0,
                  shape.id,
                ) ?? undefined;
            }
            useSelectionStore.getState().setSnapGuides(snapped.guides);
          } else {
            useSelectionStore.getState().setSnapGuides([]);
          }
          // Use the gesture-start snapshot. Create handles insert exactly one
          // vertex, and endpoint/curve drags remain stable even when the live
          // shape's point count or route changes under the pointer.
          const result = state.util.onHandleDrag(
            state.initial as never,
            state.handleId,
            point,
            { shiftKey: info.shiftKey, bindingTarget },
          );
          const patch: {
            x?: number;
            y?: number;
            props?: Record<string, unknown>;
          } = {};
          if (result.x !== undefined) patch.x = result.x;
          if (result.y !== undefined) patch.y = result.y;
          if (result.props)
            patch.props = result.props as unknown as Record<string, unknown>;
          ctx.editor.updateShape(state.shapeId, patch);
          return;
        }
        case 'rotate': {
          applyRotation(
            state,
            info.point,
            info.shiftKey,
            info.pointerType,
            false,
            ctx,
          );
          return;
        }
        case 'marquee':
          updateMarquee(state, info.point, info, ctx.editor);
          return;
      }
    },

    onPointerUp(info: ToolPointerInfo, ctx: ToolContext) {
      if (state.type === 'rotate') {
        applyRotation(
          state,
          info.point,
          info.shiftKey,
          info.pointerType,
          true,
          ctx,
        );
      } else if (state.type === 'marquee') {
        updateMarquee(state, info.point, info, ctx.editor);
      }
      commit(ctx);
    },

    onKeyDown(event: KeyboardEvent, ctx: ToolContext) {
      if (state.type === 'rotate' && event.key === 'Shift') {
        applyRotation(
          state,
          state.current,
          true,
          state.pointerType,
          false,
          ctx,
        );
        return true;
      }
      if (reapplyModifiers(event, ctx)) return true;
      if (reapplyMarqueeModifiers(event, ctx)) return true;
    },

    onKeyUp(event: KeyboardEvent, ctx: ToolContext) {
      if (state.type === 'rotate' && event.key === 'Shift') {
        applyRotation(
          state,
          state.current,
          false,
          state.pointerType,
          false,
          ctx,
        );
        return true;
      }
      if (reapplyModifiers(event, ctx)) return true;
      if (reapplyMarqueeModifiers(event, ctx)) return true;
    },

    // The OS reclaimed the pointer mid-gesture (spurious pointercancel /
    // lostpointercapture). Keep the drag result rather than reverting it.
    onCommit(ctx: ToolContext) {
      commit(ctx);
    },

    // Pinch-to-zoom (or any interrupt) restores both document and local
    // selection state, so an interrupted gesture never leaves a partial edit.
    onCancel(ctx: ToolContext) {
      const cancelled = state;
      state = { type: 'idle' };
      clearTransientState();
      const restore = (shape: Shape) =>
        ctx.editor.updateShape(shape.id, {
          x: shape.x,
          y: shape.y,
          rotation: shape.rotation,
          props: shape.props as unknown as Record<string, unknown>,
        });
      switch (cancelled.type) {
        case 'pending-shape':
        case 'pending-selection':
        case 'pending-empty':
          useSelectionStore.getState().setSelection(cancelled.selectionBefore);
          return;
        case 'move':
          ctx.editor.transact(() => {
            for (const [id, initial] of cancelled.initial) {
              ctx.editor.updateShape(id, { x: initial.x, y: initial.y });
            }
            for (const [id, parentId] of cancelled.initialParents) {
              ctx.editor.updateShape(id, { parentId });
            }
          });
          useSelectionStore.getState().setSelection(cancelled.selectionBefore);
          return;
        case 'resize':
          ctx.editor.transact(() => {
            restore(cancelled.initial);
            for (const [id, initial] of cancelled.frameChildren ?? []) {
              ctx.editor.updateShape(id, { x: initial.x, y: initial.y });
            }
          });
          return;
        case 'handle':
          restore(cancelled.initial);
          return;
        case 'rotate':
          ctx.editor.transact(() => {
            for (const item of cancelled.items) restore(item.initial);
          });
          return;
        case 'group-resize':
          for (const item of cancelled.items) restore(item.initial);
          return;
        case 'marquee':
          useSelectionStore.getState().setSelection(cancelled.selectionBefore);
          return;
        case 'idle':
          return;
      }
    },

    onDoubleClick(info: ToolPointerInfo, ctx: ToolContext) {
      const zoom = useCameraStore.getState().camera.z;
      const shapes = ctx.editor.getShapes();
      const selection = useSelectionStore.getState();
      const selectionInfo = getSelectionInfo(
        shapes,
        selection.selectedIds,
        zoom,
        ctx.editor.getShape,
        isCoarsePointer(),
      );

      // A frame corner handle is a direct "fit viewport to content" target.
      // Do this before the text-width special case because both live in the
      // generic handle list.
      const doubleClickedHandle = selectionInfo
        ? hitSelectionHandle(selectionInfo, info.point)
        : null;
      if (selectionInfo?.isSingle) {
        const selected = ctx.editor.getShape(selectionInfo.ids[0]!);
        const corner =
          doubleClickedHandle?.length === 2 ? doubleClickedHandle : null;
        if (corner && selected?.type === 'frame') {
          fitFrameToContent(ctx.editor, selected.id);
          return;
        }
      }

      // A double click on either text width handle releases the constraint and
      // returns to content-driven auto sizing. Keep the opposite side's center
      // as the visual pivot so rotated text does not jump.
      if (selectionInfo?.isSingle) {
        const handle =
          doubleClickedHandle === 'e' || doubleClickedHandle === 'w'
            ? doubleClickedHandle
            : null;
        const selected = ctx.editor.getShape(selectionInfo.ids[0]!);
        if (
          handle &&
          selected?.type === 'text' &&
          (selected.props.sizingMode === 'fixed' || selected.props.width > 0)
        ) {
          const before = layoutTextProps(selected.props);
          const props = {
            ...selected.props,
            sizingMode: 'auto' as const,
            width: 0,
          };
          const after = layoutTextProps(props);
          ctx.editor.updateShape(selected.id, {
            x:
              handle === 'e'
                ? selected.x
                : selected.x + before.width - after.width,
            y: selected.y + (before.height - after.height) / 2,
            props,
          });
          return;
        }
      }

      const hitLeaf = topmostHit(shapes, info.point, SHAPE_HIT_SCREEN / zoom);
      if (!hitLeaf) return;
      const hitShape = ctx.editor.getShape(hitLeaf);
      if (hitShape?.type === 'frame') {
        useSelectionStore.getState().setSelection([hitShape.id]);
        useFrameEditingStore.getState().start(hitShape.id);
        return;
      }
      if (hitShape?.type === 'text') {
        const index = textIndexAtWorldPoint(hitShape, info.point);
        useSelectionStore.getState().setSelection([hitShape.id]);
        useTextEditingStore
          .getState()
          .start(hitShape.id, { anchor: index, head: index });
        return;
      }
      if (hitShape?.type === 'equation') {
        useSelectionStore.getState().setSelection([hitShape.id]);
        requestEquationFocus(hitShape.id);
        return;
      }
      if (hitShape?.type === 'video') {
        useVideoPlayingStore.getState().start(hitShape.id);
        return;
      }
      if (hitShape?.type === 'bookmark') {
        // Re-check the protocol: the URL came from the shared document, so a
        // peer (or a tampered board) is not a trusted source for what opens.
        const url = safeLinkUrl(hitShape.props.url);
        if (url) window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
      if (hitShape?.type === 'image') {
        useImageCroppingStore.getState().start(hitShape.id);
        return;
      }
      const target = selectionTargetId(
        ctx.editor.getShape,
        hitLeaf,
        useEnteredGroupStore.getState().enteredGroupId,
      );
      if (ctx.editor.getShape(target)?.type === 'group') {
        useEnteredGroupStore.getState().enter(target);
        useSelectionStore
          .getState()
          .setSelection([
            selectionTargetId(ctx.editor.getShape, hitLeaf, target),
          ]);
      }
    },
  };

  return tool;
}
