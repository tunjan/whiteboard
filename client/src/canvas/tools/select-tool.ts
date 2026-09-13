import { CursorGlyph } from '@/components/ui/glyphs';
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
  type RotationHandleId,
  type SelectionInfo,
} from '../selection-geometry';
import { resizeCursor } from '../resize-cursor';
import { rotationCursor } from '../rotation-cursor';
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
      targets: BoundsSnapTarget[];
    }
  | {
      type: 'rotate';
      /** Which control started the gesture; `mobile` is the touch knob. */
      handle: RotationHandleId | 'mobile';
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
      mode: MarqueeMode;
      additive: boolean;
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

/**
 * Resize an axis-aligned box by dragging `handle` to `pointer`. With
 * `lockAspect` and a corner handle, the box keeps its original aspect ratio
 * (anchored at the opposite corner).
 */
function axisAlignedResize(
  b0: Bounds,
  handle: ResizeHandleId,
  pointer: Point,
  lockAspect: boolean,
): Bounds {
  let { minX, minY, maxX, maxY } = b0;
  if (handle.includes('w')) minX = Math.min(pointer.x, maxX - MIN_RESIZE);
  if (handle.includes('e')) maxX = Math.max(pointer.x, minX + MIN_RESIZE);
  if (handle.includes('n')) minY = Math.min(pointer.y, maxY - MIN_RESIZE);
  if (handle.includes('s')) maxY = Math.max(pointer.y, minY + MIN_RESIZE);

  if (lockAspect && handle.length === 2) {
    const w0 = b0.maxX - b0.minX || 1;
    const h0 = b0.maxY - b0.minY || 1;
    const scale = Math.max((maxX - minX) / w0, (maxY - minY) / h0);
    const width = w0 * scale;
    const height = h0 * scale;
    if (handle.includes('w')) minX = maxX - width;
    else maxX = minX + width;
    if (handle.includes('n')) minY = maxY - height;
    else maxY = minY + height;
  }
  return { minX, minY, maxX, maxY };
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
 * Scale factors for dragging `handle` to `pointer`, both given in the box's own
 * frame. The opposite handle anchors the gesture, so the far edge stays put. An
 * edge handle has no extent along its other axis, which falls out of the
 * division as leaving that axis alone; locking the aspect ratio lets whichever
 * axis moved further drive both.
 */
function resizeScale(
  b0: Bounds,
  handle: ResizeHandleId,
  pointer: Point,
  lockAspect: boolean,
): { sx: number; sy: number } {
  const anchor = handlePoint(b0, OPPOSITE_HANDLE[handle]);
  const start = handlePoint(b0, handle);
  const dx0 = start.x - anchor.x;
  const dy0 = start.y - anchor.y;
  const w0 = b0.maxX - b0.minX || 1;
  const h0 = b0.maxY - b0.minY || 1;
  let sx = dx0 === 0 ? 1 : (pointer.x - anchor.x) / dx0;
  let sy = dy0 === 0 ? 1 : (pointer.y - anchor.y) / dy0;
  // Shapes have no way to express a mirrored result, so a handle dragged past
  // its anchor collapses the box to a sliver instead of turning it inside out.
  // Only the axes the handle actually drives are floored; an edge handle leaves
  // its other axis at 1, which a floor above 1 would silently grow.
  if (dx0 !== 0) sx = Math.max(sx, MIN_RESIZE / w0);
  if (dy0 !== 0) sy = Math.max(sy, MIN_RESIZE / h0);
  if (lockAspect) {
    if (dx0 === 0) sx = sy;
    else if (dy0 === 0) sy = sx;
    else if (sx > sy) sy = sx;
    else sx = sy;
  }
  return { sx, sy };
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

/** New unrotated world bounds for a resize, corrected for the shape's rotation. */
function computeResizeBounds(
  initial: Shape,
  util: ShapeUtil,
  handle: ResizeHandleId,
  pointer: Point,
  lockAspect: boolean,
): Bounds {
  const b0 = util.getBounds(initial as never);
  const c0 = boundsCenter(b0);
  const localPointer = initial.rotation
    ? rotatePoint(pointer, c0, -initial.rotation)
    : pointer;
  const b1 = axisAlignedResize(b0, handle, localPointer, lockAspect);
  if (!initial.rotation) return b1;

  // Keep the displayed anchor (opposite corner) fixed as the pivot shifts.
  const anchor = {
    x: handle.includes('e')
      ? b1.minX
      : handle.includes('w')
        ? b1.maxX
        : b1.minX,
    y: handle.includes('s')
      ? b1.minY
      : handle.includes('n')
        ? b1.maxY
        : b1.minY,
  };
  const c1 = boundsCenter(b1);
  const o0 = rotatePoint(anchor, c0, initial.rotation);
  const o1 = rotatePoint(anchor, c1, initial.rotation);
  const ox = o0.x - o1.x;
  const oy = o0.y - o1.y;
  return {
    minX: b1.minX + ox,
    minY: b1.minY + oy,
    maxX: b1.maxX + ox,
    maxY: b1.maxY + oy,
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

function marqueeMode(ctrlKey: boolean, metaKey: boolean): MarqueeMode {
  return ctrlKey || metaKey ? 'wrap' : 'intersect';
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
  handle: RotationHandleId | 'mobile',
): Extract<SelectState, { type: 'rotate' }> {
  return {
    type: 'rotate',
    handle,
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
    // Touch started this from the knob, which has no cursor to keep pointed.
    if (rotate.handle !== 'mobile') {
      useSelectionStore
        .getState()
        .setGestureCursor(rotationCursor(rotate.handle, target));
    }
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
    pointer: Point,
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
        !marqueeIntersectsMask(parent, bounds, pointer)
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
    pointer: Point,
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
      if (!intersectsAncestorMasks(shape, bounds, pointer, editor)) continue;
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
              intersectsAncestorMasks(shape, bounds, pointer, editor),
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

  function updateMarquee(
    marquee: Extract<SelectState, { type: 'marquee' }>,
    point: Point,
    shiftKey: boolean,
    ctrlKey: boolean,
    metaKey: boolean,
    editor: Editor,
  ): void {
    const bounds = marqueeBounds(marquee.start, point);
    marquee.current = point;
    marquee.mode = marqueeMode(ctrlKey, metaKey);
    marquee.additive = shiftKey;
    useSelectionStore.getState().setMarquee({ bounds, mode: marquee.mode });
    selectMarquee(
      bounds,
      marquee.mode,
      marquee.additive,
      marquee.selectionBefore,
      point,
      editor,
    );
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

  return {
    id: 'select',
    label: 'Select',
    hotkey: 'v',
    cursor: 'default',
    icon: CursorGlyph,

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

        // Rotation lives in four invisible zones just outside the corners,
        // leaving the top-center lane free for the contextual toolbar. Touch
        // gets one visible knob in their place, tested first because it can
        // sit over the box rather than outside it.
        const knob = selectionInfo.mobileRotateHandle;
        if (knob && distance(info.point, knob.point) <= knob.radius) {
          const items = rotationItems(shapes, selectionInfo, ctx.editor);
          if (items.length) {
            state = rotateState(selectionInfo, info, items, 'mobile');
          }
          return;
        }
        for (const handle of selectionInfo.rotationHandles) {
          // The zone is a square that turns with the box, so it is tested in
          // the box's own frame rather than by distance.
          const local = rotatePoint(
            info.point,
            handle.point,
            -selectionInfo.rotation,
          );
          if (
            Math.abs(local.x - handle.point.x) > handle.extent ||
            Math.abs(local.y - handle.point.y) > handle.extent
          ) {
            continue;
          }
          const items = rotationItems(shapes, selectionInfo, ctx.editor);
          if (items.length) {
            state = rotateState(selectionInfo, info, items, handle.id);
            useSelectionStore
              .getState()
              .setGestureCursor(
                rotationCursor(handle.id, selectionInfo.rotation),
              );
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
          const start = state.start;
          state = {
            type: 'marquee',
            start,
            current: info.point,
            selectionBefore: state.selectionBefore,
            mode: marqueeMode(info.ctrlKey, info.metaKey),
            additive: info.shiftKey,
          };
          // Evaluate on the first drag sample rather than waiting for another move.
          updateMarquee(
            state,
            info.point,
            info.shiftKey,
            info.ctrlKey,
            info.metaKey,
            ctx.editor,
          );
          return;
        }
        case 'move':
          applyMove(state, info, ctx);
          return;
        case 'resize': {
          const lockAspect =
            info.shiftKey ||
            ((state.initial.type === 'text' ||
              state.initial.type === 'equation' ||
              state.initial.type === 'sticker') &&
              state.handle.length === 2);
          let bounds = computeResizeBounds(
            state.initial,
            state.util,
            state.handle,
            {
              x: info.point.x - state.grabOffset.x,
              y: info.point.y - state.grabOffset.y,
            },
            lockAspect,
          );
          if (useCanvasUiStore.getState().snappingEnabled && !info.altKey) {
            const camera = useCameraStore.getState().camera;
            const background = useCanvasUiStore.getState().background;
            const initialBounds = state.util.getBounds(state.initial as never);
            const snapped = snapResizeBounds(
              bounds,
              state.handle,
              state.targets,
              info.metaKey || info.ctrlKey
                ? null
                : getSnapGridStep(background, camera),
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
          const resized = state.util.resize(state.initial as never, bounds);
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
          const anchor = handlePoint(
            state.aligned0,
            OPPOSITE_HANDLE[state.handle],
          );
          const w0 = state.aligned0.maxX - state.aligned0.minX;
          const h0 = state.aligned0.maxY - state.aligned0.minY;
          let { sx, sy } = resizeScale(
            state.aligned0,
            state.handle,
            pointer,
            info.shiftKey,
          );
          // Alignment guides are page-axis features, so they only mean
          // something while the box still shares those axes.
          if (
            state.rotation === 0 &&
            useCanvasUiStore.getState().snappingEnabled &&
            !info.altKey
          ) {
            const camera = useCameraStore.getState().camera;
            const background = useCanvasUiStore.getState().background;
            const snapped = snapResizeBounds(
              scaleBounds(state.aligned0, anchor, sx, sy),
              state.handle,
              state.targets,
              info.metaKey || info.ctrlKey
                ? null
                : getSnapGridStep(background, camera),
              SNAP_SCREEN / camera.z,
              info.shiftKey,
              w0 / (h0 || 1),
            );
            sx = (snapped.bounds.maxX - snapped.bounds.minX) / (w0 || 1);
            sy = (snapped.bounds.maxY - snapped.bounds.minY) / (h0 || 1);
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
              // Off-axis shapes take the smaller factor on both axes: scaling
              // their two axes apart would shear them, and the shape model has
              // no way to hold a shear.
              const uniform = Math.min(sx, sy);
              const w =
                item.quarterTurns === null ? uniform : swapped ? sy : sx;
              const h =
                item.quarterTurns === null ? uniform : swapped ? sx : sy;
              const scaled: Bounds = {
                minX: moved.x - (iw * w) / 2,
                maxX: moved.x + (iw * w) / 2,
                minY: moved.y - (ih * h) / 2,
                maxY: moved.y + (ih * h) / 2,
              };
              const resized = item.util.resize(item.initial as never, scaled);
              ctx.editor.updateShape(item.initial.id, {
                x: resized.x,
                y: resized.y,
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
        case 'marquee': {
          updateMarquee(
            state,
            info.point,
            info.shiftKey,
            info.ctrlKey,
            info.metaKey,
            ctx.editor,
          );
          return;
        }
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
        updateMarquee(
          state,
          info.point,
          info.shiftKey,
          info.ctrlKey,
          info.metaKey,
          ctx.editor,
        );
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
      if (
        state.type !== 'marquee' ||
        (event.key !== 'Shift' &&
          event.key !== 'Control' &&
          event.key !== 'Meta')
      ) {
        return;
      }
      updateMarquee(
        state,
        state.current,
        event.shiftKey,
        event.ctrlKey,
        event.metaKey,
        ctx.editor,
      );
      return true;
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
      if (
        state.type !== 'marquee' ||
        (event.key !== 'Shift' &&
          event.key !== 'Control' &&
          event.key !== 'Meta')
      ) {
        return;
      }
      updateMarquee(
        state,
        state.current,
        event.shiftKey,
        event.ctrlKey,
        event.metaKey,
        ctx.editor,
      );
      return true;
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
}
