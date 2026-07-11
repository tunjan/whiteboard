import { MousePointer2 } from 'lucide-react';
import {
  type Bounds,
  type Point,
  type Shape,
  boundsCenter,
  boundsContainsPoint,
  distance,
  isContainerType,
  rotatePoint,
} from '@whiteboard/shared';
import {
  getSelectionInfo,
  matchesMarquee,
  shapeRotatedBounds,
  type MarqueeMode,
  type ResizeHandleId,
} from '../selection-geometry';
import {
  leafDescendants,
  moveTargetIds,
  selectionTargetId,
} from '../hierarchy';
import { getSnapGridStep } from '../grid';
import { isSelectable, isVisible } from '../selectable';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { shapeRegistry } from '../shapes/shape-registry';
import { textIndexAtWorldPoint } from '../shapes/text';
import { layoutTextProps, MIN_TEXT_WIDTH } from '../shapes/text-measure';
import type { ShapeUtil } from '../shapes/types';
import { snapBounds } from '../snapping';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { useTextEditingStore } from '../use-text-editing-store';
import { useVideoPlayingStore } from '../use-video-playing-store';
import { useImageCroppingStore } from '../use-image-cropping-store';
import type { Editor } from '../editor';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const HANDLE_HIT_SCREEN = 10;
const SHAPE_HIT_SCREEN = 4;
const DRAG_SLOP_SCREEN = 3;
const ROTATE_SNAP = (15 * Math.PI) / 180;
const MIN_RESIZE = 1;
/** Snap threshold in screen px (divided by zoom for world distance). */
const SNAP_SCREEN = 6;

interface GroupItem {
  initial: Shape;
  util: ShapeUtil;
  /** The shape's unrotated bounds at gesture start. */
  b0: Bounds;
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
      bounds0: Bounds | null;
      selectionBefore: string[];
      axis: Axis | null;
    }
  | { type: 'resize'; handle: ResizeHandleId; initial: Shape; util: ShapeUtil }
  | {
      type: 'group-resize';
      handle: ResizeHandleId;
      bounds0: Bounds;
      items: GroupItem[];
    }
  | { type: 'rotate'; initial: Shape; center: Point; startAngle: number }
  | {
      type: 'handle';
      shapeId: string;
      handleId: string;
      util: ShapeUtil;
      initial: Shape;
    }
  | {
      type: 'marquee';
      start: Point;
      base: string[];
      selectionBefore: string[];
      mode: MarqueeMode;
    };

/** Topmost selectable shape under a world point, after an R-tree broad phase. */
function topmostHit(shapes: Shape[], p: Point, tol: number): string | null {
  const candidates = new Set(
    spatialIndex.search({
      minX: p.x - tol,
      minY: p.y - tol,
      maxX: p.x + tol,
      maxY: p.y + tol,
    }),
  );
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (!candidates.has(shape.id) || !isSelectable(shape)) continue;
    if (shapeRegistry.getFor(shape)?.hitTest(shape, p, tol)) return shape.id;
  }
  return null;
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
    x: handle.includes('e') ? b1.minX : handle.includes('w') ? b1.maxX : b1.minX,
    y: handle.includes('s') ? b1.minY : handle.includes('n') ? b1.maxY : b1.minY,
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

/** Reflect the (first) selected shape's style in the style panel. */
function syncStyleFromSelection(editor: Editor): void {
  const { selectedIds } = useSelectionStore.getState();
  const first = selectedIds[0] ? editor.getShape(selectedIds[0]) : undefined;
  if (!first) return;
  const props = first.props as {
    color?: string;
    size?: number;
    fillStyle?: 'none' | 'solid' | 'hatch' | 'crosshatch';
    dash?: 'solid' | 'dashed' | 'dotted';
    kind?: 'triangle' | 'diamond' | 'trapezoid' | 'pentagon' | 'hexagon';
    fontFamily?: 'sans' | 'serif' | 'mono';
    align?: 'start' | 'middle' | 'end';
    arrowStart?: boolean;
    arrowEnd?: boolean;
  };
  const style = useStyleStore.getState();
  style.setOpacity(typeof first.opacity === 'number' ? first.opacity : 1);
  if (typeof props.color === 'string') style.setColor(props.color);
  if (typeof props.size === 'number') style.setSize(props.size);
  if (props.fillStyle) style.setFill(props.fillStyle);
  if (props.dash) style.setDash(props.dash);
  if (props.kind) style.setPolygonKind(props.kind);
  if (first.type === 'arrow') {
    if (typeof props.arrowStart === 'boolean') style.setArrowStart(props.arrowStart);
    if (typeof props.arrowEnd === 'boolean') style.setArrowEnd(props.arrowEnd);
  }
  if (first.type === 'text' && props.fontFamily) style.setFontFamily(props.fontFamily);
  if (first.type === 'text' && props.align) style.setAlign(props.align);
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

function marqueeMode(start: Point, point: Point): MarqueeMode {
  return point.x >= start.x ? 'contain' : 'touch';
}

export function createSelectTool(): Tool {
  let state: SelectState = { type: 'idle' };

  function createMoveState(
    start: Point,
    selectionBefore: string[],
    editor: Editor,
  ): Extract<SelectState, { type: 'move' }> {
    // Expand selection to the shapes that actually move (group → descendants,
    // frame → frame + descendants, leaf → itself).
    const shapes = editor.getShapes();
    const ids = moveTargetIds(shapes, useSelectionStore.getState().selectedIds);
    const initial = new Map<string, { x: number; y: number }>();
    let bounds0: Bounds | null = null;
    for (const id of ids) {
      const shape = editor.getShape(id);
      // Locked shapes stay put even when part of the selection.
      if (!shape || shape.locked) continue;
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
    return { type: 'move', start, initial, bounds0, selectionBefore, axis: null };
  }

  /** Other visible, non-moving shapes' bounds near the moving box (for snap). */
  function snapTargets(
    editor: Editor,
    movingIds: Set<string>,
    region: Bounds,
  ): Bounds[] {
    const targets: Bounds[] = [];
    for (const id of spatialIndex.search(region)) {
      if (movingIds.has(id)) continue;
      const shape = editor.getShape(id);
      if (!shape || !isVisible(shape)) continue;
      // The spatial index already holds this shape's rotated world bounds (it's
      // what `search` matched on), so reuse them instead of recomputing.
      const bounds = spatialIndex.getBounds(id);
      if (bounds) targets.push(bounds);
    }
    return targets;
  }

  function applyMove(move: Extract<SelectState, { type: 'move' }>, info: ToolPointerInfo, ctx: ToolContext): void {
    const rawDx = info.point.x - move.start.x;
    const rawDy = info.point.y - move.start.y;
    if (!info.shiftKey) move.axis = null;
    else if (!move.axis) move.axis = Math.abs(rawDx) >= Math.abs(rawDy) ? 'x' : 'y';

    let dx = move.axis === 'y' ? 0 : rawDx;
    let dy = move.axis === 'x' ? 0 : rawDy;
    if (!info.altKey && move.bounds0) {
      const camera = useCameraStore.getState().camera;
      const threshold = SNAP_SCREEN / camera.z;
      const moving: Bounds = {
        minX: move.bounds0.minX + dx,
        minY: move.bounds0.minY + dy,
        maxX: move.bounds0.maxX + dx,
        maxY: move.bounds0.maxY + dy,
      };
      const region = {
        minX: moving.minX - threshold,
        minY: moving.minY - threshold,
        maxX: moving.maxX + threshold,
        maxY: moving.maxY + threshold,
      };
      const background = useCanvasUiStore.getState().background;
      const snap = snapBounds(
        moving,
        snapTargets(ctx.editor, new Set(move.initial.keys()), region),
        getSnapGridStep(background, camera),
        threshold,
      );
      if (move.axis !== 'y') dx += snap.dx;
      if (move.axis !== 'x') dy += snap.dy;
      useSelectionStore.getState().setSnapGuides(
        snap.guides.filter((guide) =>
          move.axis === 'x' ? guide.axis === 'x' : move.axis === 'y' ? guide.axis === 'y' : true,
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
  }

  function selectMarquee(bounds: Bounds, mode: MarqueeMode, base: string[], editor: Editor): void {
    const shapes = editor.getShapes();
    const candidates = new Set(spatialIndex.search(bounds));
    const entered = useEnteredGroupStore.getState().enteredGroupId;
    const found = new Set<string>();
    const containingGroups = new Set<string>();

    for (const shape of shapes) {
      if (!candidates.has(shape.id) || !isSelectable(shape)) continue;
      if (!matchesMarquee(shape, bounds, mode)) continue;
      const target = selectionTargetId(editor.getShape, shape.id, entered);
      if (editor.getShape(target)?.type === 'group' && mode === 'contain') {
        containingGroups.add(target);
      } else {
        found.add(target);
      }
    }

    for (const groupId of containingGroups) {
      const leaves = leafDescendants(shapes, groupId).filter(isSelectable);
      if (leaves.length > 0 && leaves.every((shape) => matchesMarquee(shape, bounds, mode))) {
        found.add(groupId);
      }
    }

    useSelectionStore.getState().setSelection([...new Set([...base, ...found])]);
  }

  function reparentMovedLeaves(move: Extract<SelectState, { type: 'move' }>, ctx: ToolContext): void {
    const shapes = ctx.editor.getShapes();
    const movingIds = new Set(move.initial.keys());
    for (const id of move.initial.keys()) {
      const shape = ctx.editor.getShape(id);
      if (!shape || isContainerType(shape.type)) continue;
      const parent = shape.parentId ? ctx.editor.getShape(shape.parentId) : null;
      // Preserve membership in explicit groups; only frame parenting follows a drag.
      if (parent?.type === 'group') continue;
      const util = shapeRegistry.getFor(shape);
      if (!util) continue;
      const center = boundsCenter(util.getBounds(shape));
      const nextParentId = topFrameAt(shapes, center, movingIds);
      if ((shape.parentId ?? null) !== (nextParentId ?? null)) {
        ctx.editor.updateShape(id, { parentId: nextParentId });
      }
    }
  }

  function clearTransientState(): void {
    useSelectionStore.getState().setMarquee(null);
    useSelectionStore.getState().setSnapGuides([]);
  }

  // Finish the gesture, keeping its result. The live drag already wrote the
  // moved/resized/rotated transform to the document during onPointerMove, so
  // this only runs the post-gesture bookkeeping. Shared by pointer-up and
  // commit (the OS reclaimed the pointer mid-gesture).
  function commit(ctx: ToolContext): void {
    const finished = state;
    if (finished.type === 'pending-shape') {
      if (finished.additive) {
        useSelectionStore.getState().toggle(finished.targetId);
      }
      syncStyleFromSelection(ctx.editor);
    } else if (finished.type === 'pending-empty') {
      if (!finished.additive) useSelectionStore.getState().clear();
    } else if (finished.type === 'marquee') {
      syncStyleFromSelection(ctx.editor);
    } else if (finished.type === 'move') {
      reparentMovedLeaves(finished, ctx);
    }
    clearTransientState();
    state = { type: 'idle' };
  }

  return {
    id: 'select',
    label: 'Select',
    hotkey: 'v',
    cursor: 'default',
    icon: MousePointer2,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const zoom = useCameraStore.getState().camera.z;
      const selection = useSelectionStore.getState();
      const shapes = ctx.editor.getShapes();
      const selectionInfo = getSelectionInfo(shapes, selection.selectedIds, zoom);

      // 1a. Custom shape handles (connector endpoints/bend) take priority.
      if (selectionInfo?.isSingle && selectionInfo.customHandles) {
        for (const handle of selectionInfo.customHandles) {
          if (distance(info.point, handle.point) > HANDLE_HIT_SCREEN / zoom) continue;
          const shape = ctx.editor.getShape(selectionInfo.ids[0]!);
          const util = shape ? shapeRegistry.getFor(shape) : undefined;
          if (shape && util?.onHandleDrag) {
            state = {
              type: 'handle',
              shapeId: shape.id,
              handleId: handle.id,
              util,
              initial: shape,
            };
            return;
          }
        }
      }

      // 1b. Generic resize/rotate box handles (single or group bounding box).
      if (selectionInfo) {
        for (const handle of selectionInfo.handles) {
          if (distance(info.point, handle.point) > HANDLE_HIT_SCREEN / zoom) continue;
          if (handle.id === 'rotate') {
            const initial = ctx.editor.getShape(selectionInfo.ids[0]!);
            if (initial) {
              state = {
                type: 'rotate',
                initial,
                center: selectionInfo.center,
                startAngle: Math.atan2(
                  info.point.y - selectionInfo.center.y,
                  info.point.x - selectionInfo.center.x,
                ),
              };
            }
          } else if (selectionInfo.isSingle) {
            const initial = ctx.editor.getShape(selectionInfo.ids[0]!);
            const util = initial ? shapeRegistry.getFor(initial) : undefined;
            if (initial && util?.canResize) state = { type: 'resize', handle: handle.id, initial, util };
          } else {
            const items: GroupItem[] = [];
            for (const id of selectionInfo.ids) {
              const shape = ctx.editor.getShape(id);
              if (!shape || shape.locked) continue;
              const util = shapeRegistry.getFor(shape);
              if (util?.canResize) items.push({ initial: shape, util, b0: util.getBounds(shape as never) });
            }
            if (items.length) {
              state = { type: 'group-resize', handle: handle.id, bounds0: selectionInfo.bounds, items };
            }
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
          syncStyleFromSelection(ctx.editor);
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

      // 3. Empty space inside a multi-selection box can drag that selection.
      if (
        !info.shiftKey &&
        selectionInfo &&
        !selectionInfo.isSingle &&
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
            useSelectionStore.getState().setSelection([
              ...new Set([...state.selectionBefore, state.targetId]),
            ]);
            syncStyleFromSelection(ctx.editor);
          }
          const move = createMoveState(state.start, state.selectionBefore, ctx.editor);
          state = move;
          applyMove(move, info, ctx);
          return;
        }
        case 'pending-selection': {
          if (!hasCrossedDragSlop(state.screenStart, info.screenPoint)) return;
          const move = createMoveState(state.start, state.selectionBefore, ctx.editor);
          state = move;
          applyMove(move, info, ctx);
          return;
        }
        case 'pending-empty': {
          if (!hasCrossedDragSlop(state.screenStart, info.screenPoint)) return;
          const start = state.start;
          const base = state.additive ? state.selectionBefore : [];
          if (!state.additive) useSelectionStore.getState().clear();
          state = {
            type: 'marquee',
            start,
            base,
            selectionBefore: state.selectionBefore,
            mode: marqueeMode(start, info.point),
          };
          // Fall through on the same sample so the marquee starts at the first drag frame.
          const bounds = marqueeBounds(state.start, info.point);
          state.mode = marqueeMode(state.start, info.point);
          useSelectionStore.getState().setMarquee({ bounds, mode: state.mode });
          selectMarquee(bounds, state.mode, state.base, ctx.editor);
          return;
        }
        case 'move':
          applyMove(state, info, ctx);
          return;
        case 'resize': {
          const bounds = computeResizeBounds(
            state.initial,
            state.util,
            state.handle,
            info.point,
            info.shiftKey ||
              (state.initial.type === 'text' && state.handle.length === 2),
          );
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
          ctx.editor.updateShape(state.initial.id, {
            x: resized.x,
            y: resized.y,
            props: resized.props as unknown as Record<string, unknown>,
          });
          return;
        }
        case 'group-resize': {
          const bounds = axisAlignedResize(state.bounds0, state.handle, info.point, info.shiftKey);
          const sx = (bounds.maxX - bounds.minX) / (state.bounds0.maxX - state.bounds0.minX || 1);
          const sy = (bounds.maxY - bounds.minY) / (state.bounds0.maxY - state.bounds0.minY || 1);
          const fixedX = state.handle.includes('w') ? state.bounds0.maxX : state.bounds0.minX;
          const fixedY = state.handle.includes('n') ? state.bounds0.maxY : state.bounds0.minY;
          const items = state.items;
          ctx.editor.transact(() => {
            for (const item of items) {
              const scaled: Bounds = {
                minX: fixedX + (item.b0.minX - fixedX) * sx,
                maxX: fixedX + (item.b0.maxX - fixedX) * sx,
                minY: fixedY + (item.b0.minY - fixedY) * sy,
                maxY: fixedY + (item.b0.maxY - fixedY) * sy,
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
          const result = state.util.onHandleDrag(shape as never, state.handleId, info.point, {
            shiftKey: info.shiftKey,
          });
          const patch: { x?: number; y?: number; props?: Record<string, unknown> } = {};
          if (result.x !== undefined) patch.x = result.x;
          if (result.y !== undefined) patch.y = result.y;
          if (result.props) patch.props = result.props as unknown as Record<string, unknown>;
          ctx.editor.updateShape(state.shapeId, patch);
          return;
        }
        case 'rotate': {
          const angle = Math.atan2(
            info.point.y - state.center.y,
            info.point.x - state.center.x,
          );
          let rotation = state.initial.rotation + (angle - state.startAngle);
          if (info.shiftKey) rotation = Math.round(rotation / ROTATE_SNAP) * ROTATE_SNAP;
          ctx.editor.updateShape(state.initial.id, { rotation });
          return;
        }
        case 'marquee': {
          const bounds = marqueeBounds(state.start, info.point);
          state.mode = marqueeMode(state.start, info.point);
          useSelectionStore.getState().setMarquee({ bounds, mode: state.mode });
          selectMarquee(bounds, state.mode, state.base, ctx.editor);
          return;
        }
      }
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      commit(ctx);
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
          });
          useSelectionStore.getState().setSelection(cancelled.selectionBefore);
          return;
        case 'resize':
        case 'rotate':
        case 'handle':
          restore(cancelled.initial);
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
      const selectionInfo = getSelectionInfo(shapes, selection.selectedIds, zoom);

      // A double click on either text width handle releases the constraint and
      // returns to content-driven auto sizing. Keep the opposite side's center
      // as the visual pivot so rotated text does not jump.
      if (selectionInfo?.isSingle) {
        const handle = selectionInfo.handles.find(
          (candidate) =>
            (candidate.id === 'e' || candidate.id === 'w') &&
            distance(info.point, candidate.point) <= HANDLE_HIT_SCREEN / zoom,
        );
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
              handle.id === 'e'
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
      if (hitShape?.type === 'text') {
        const index = textIndexAtWorldPoint(hitShape, info.point);
        useSelectionStore.getState().setSelection([hitShape.id]);
        useTextEditingStore
          .getState()
          .start(hitShape.id, { anchor: index, head: index });
        return;
      }
      if (hitShape?.type === 'video') {
        useVideoPlayingStore.getState().start(hitShape.id);
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
        useSelectionStore.getState().setSelection([
          selectionTargetId(ctx.editor.getShape, hitLeaf, target),
        ]);
      }
    },
  };
}

/** Topmost visible frame whose interior contains world point `point`. */
function topFrameAt(shapes: Shape[], point: Point, excludeIds: Set<string>): string | null {
  const candidates = new Set(
    spatialIndex.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }),
  );
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (
      !candidates.has(shape.id) ||
      shape.type !== 'frame' ||
      excludeIds.has(shape.id) ||
      !isVisible(shape)
    ) {
      continue;
    }
    if (
      point.x >= shape.x &&
      point.x <= shape.x + shape.props.w &&
      point.y >= shape.y &&
      point.y <= shape.y + shape.props.h
    ) {
      return shape.id;
    }
  }
  return null;
}
