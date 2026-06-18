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
  shapeRotatedBounds,
  type ResizeHandleId,
} from '../selection-geometry';
import { isSelectable, isVisible } from '../selectable';
import { getSnapGridStep } from '../grid';
import { moveTargetIds, selectionTargetId } from '../hierarchy';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { shapeRegistry } from '../shapes/shape-registry';
import type { ShapeUtil } from '../shapes/types';
import { snapBounds } from '../snapping';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { useTextEditingStore } from '../use-text-editing-store';
import type { Editor } from '../editor';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

const HANDLE_HIT_SCREEN = 10;
const SHAPE_HIT_SCREEN = 4;
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

type Gesture =
  | {
      type: 'move';
      start: Point;
      initial: Map<string, { x: number; y: number }>;
      bounds0: Bounds | null;
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
  | { type: 'marquee'; start: Point; base: string[] }
  | null;

/** Topmost selectable shape under a world point, or null. */
function topmostHit(shapes: Shape[], p: Point, tol: number): string | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (!isSelectable(s)) continue;
    const util = shapeRegistry.getFor(s);
    if (util?.hitTest(s, p, tol)) return s.id;
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
    const s = Math.max((maxX - minX) / w0, (maxY - minY) / h0);
    const w = w0 * s;
    const h = h0 * s;
    if (handle.includes('w')) minX = maxX - w;
    else maxX = minX + w;
    if (handle.includes('n')) minY = maxY - h;
    else maxY = minY + h;
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
  const b0 = util.getBounds(initial);
  const c0 = boundsCenter(b0);
  const r = initial.rotation;
  const pl = r ? rotatePoint(pointer, c0, -r) : pointer;

  const b1 = axisAlignedResize(b0, handle, pl, lockAspect);
  if (!r) return b1;

  // Keep the displayed anchor (opposite corner) fixed as the pivot shifts.
  const anchor = {
    x: handle.includes('e') ? b1.minX : handle.includes('w') ? b1.maxX : b1.minX,
    y: handle.includes('s') ? b1.minY : handle.includes('n') ? b1.maxY : b1.minY,
  };
  const c1 = boundsCenter(b1);
  const o0 = rotatePoint(anchor, c0, r);
  const o1 = rotatePoint(anchor, c1, r);
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

export function createSelectTool(): Tool {
  let gesture: Gesture = null;

  function startMove(start: Point, editor: Editor) {
    // Expand selection to the shapes that actually move (group → descendants,
    // frame → frame + descendants, leaf → itself).
    const shapes = editor.getShapes();
    const ids = moveTargetIds(shapes, useSelectionStore.getState().selectedIds);
    const initial = new Map<string, { x: number; y: number }>();
    let bounds0: Bounds | null = null;
    for (const id of ids) {
      const s = editor.getShape(id);
      // Locked shapes stay put even when part of the selection.
      if (!s || s.locked) continue;
      initial.set(id, { x: s.x, y: s.y });
      const rb = shapeRotatedBounds(s);
      bounds0 = bounds0
        ? {
            minX: Math.min(bounds0.minX, rb.minX),
            minY: Math.min(bounds0.minY, rb.minY),
            maxX: Math.max(bounds0.maxX, rb.maxX),
            maxY: Math.max(bounds0.maxY, rb.maxY),
          }
        : rb;
    }
    gesture = { type: 'move', start, initial, bounds0 };
  }

  /** Other visible, non-moving shapes' bounds near the moving box (for snap). */
  function snapTargets(
    editor: Editor,
    movingIds: Set<string>,
    region: Bounds,
  ): Bounds[] {
    const out: Bounds[] = [];
    for (const id of spatialIndex.search(region)) {
      if (movingIds.has(id)) continue;
      const s = editor.getShape(id);
      if (!s || !isVisible(s)) continue;
      out.push(shapeRotatedBounds(s));
    }
    return out;
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
      const sel = useSelectionStore.getState();
      const shapes = ctx.editor.getShapes();
      const sinfo = getSelectionInfo(shapes, sel.selectedIds, zoom);

      // 1a. Custom shape handles (connector endpoints/bend) take priority.
      if (sinfo?.isSingle && sinfo.customHandles) {
        for (const h of sinfo.customHandles) {
          if (distance(info.point, h.point) <= HANDLE_HIT_SCREEN / zoom) {
            const shape = ctx.editor.getShape(sinfo.ids[0]!);
            const util = shape ? shapeRegistry.getFor(shape) : undefined;
            if (shape && util?.onHandleDrag) {
              gesture = {
                type: 'handle',
                shapeId: shape.id,
                handleId: h.id,
                util,
                initial: shape,
              };
              return;
            }
          }
        }
      }

      // 1b. Generic resize/rotate box handles (single or group bounding box).
      if (sinfo) {
        for (const h of sinfo.handles) {
          if (distance(info.point, h.point) > HANDLE_HIT_SCREEN / zoom) continue;
          if (h.id === 'rotate') {
            const initial = ctx.editor.getShape(sinfo.ids[0]!);
            if (!initial) break;
            gesture = {
              type: 'rotate',
              initial,
              center: sinfo.center,
              startAngle: Math.atan2(
                info.point.y - sinfo.center.y,
                info.point.x - sinfo.center.x,
              ),
            };
          } else if (sinfo.isSingle) {
            const initial = ctx.editor.getShape(sinfo.ids[0]!);
            const util = initial ? shapeRegistry.getFor(initial) : undefined;
            if (initial && util?.canResize) {
              gesture = { type: 'resize', handle: h.id, initial, util };
            }
          } else {
            // Group resize: scale every unlocked, resizable member together.
            const items: GroupItem[] = [];
            for (const id of sinfo.ids) {
              const s = ctx.editor.getShape(id);
              if (!s || s.locked) continue;
              const util = shapeRegistry.getFor(s);
              if (util?.canResize) items.push({ initial: s, util, b0: util.getBounds(s) });
            }
            if (items.length) {
              gesture = {
                type: 'group-resize',
                handle: h.id,
                bounds0: sinfo.bounds,
                items,
              };
            }
          }
          return;
        }
      }

      // 2. A shape under the pointer → resolve to its group (unless entered).
      const hitLeaf = topmostHit(shapes, info.point, SHAPE_HIT_SCREEN / zoom);
      if (hitLeaf) {
        const entered = useEnteredGroupStore.getState().enteredGroupId;
        const hitId = selectionTargetId(ctx.editor.getShape, hitLeaf, entered);
        if (info.shiftKey) {
          sel.toggle(hitId);
          syncStyleFromSelection(ctx.editor);
          return;
        }
        if (!sel.selectedIds.includes(hitId)) sel.setSelection([hitId]);
        startMove(info.point, ctx.editor);
        syncStyleFromSelection(ctx.editor);
        return;
      }

      // 3. Empty space inside a multi-selection box → drag the whole group.
      if (sinfo && !sinfo.isSingle && boundsContainsPoint(sinfo.bounds, info.point)) {
        startMove(info.point, ctx.editor);
        return;
      }

      // 4. Empty space → exit any entered group, then marquee.
      useEnteredGroupStore.getState().exit();
      const base = info.shiftKey ? sel.selectedIds : [];
      if (!info.shiftKey) sel.clear();
      gesture = { type: 'marquee', start: info.point, base };
    },

    onPointerMove(info: ToolPointerInfo, ctx: ToolContext) {
      if (!gesture) return;
      switch (gesture.type) {
        case 'move': {
          const rawDx = info.point.x - gesture.start.x;
          const rawDy = info.point.y - gesture.start.y;
          let dx = rawDx;
          let dy = rawDy;
          // Snap to other shapes' edges/centers and grid intervals (Alt = off).
          if (!info.altKey && gesture.bounds0) {
            const camera = useCameraStore.getState().camera;
            const threshold = SNAP_SCREEN / camera.z;
            const b0 = gesture.bounds0;
            const moving: Bounds = {
              minX: b0.minX + rawDx,
              minY: b0.minY + rawDy,
              maxX: b0.maxX + rawDx,
              maxY: b0.maxY + rawDy,
            };
            const region = {
              minX: moving.minX - threshold,
              minY: moving.minY - threshold,
              maxX: moving.maxX + threshold,
              maxY: moving.maxY + threshold,
            };
            const targets = snapTargets(
              ctx.editor,
              new Set(gesture.initial.keys()),
              region,
            );
            const bg = useCanvasUiStore.getState().background;
            const gridStep = getSnapGridStep(bg, camera);
            const snap = snapBounds(moving, targets, gridStep, threshold);
            dx += snap.dx;
            dy += snap.dy;
            useSelectionStore.getState().setSnapGuides(snap.guides);
          } else {
            useSelectionStore.getState().setSnapGuides([]);
          }
          for (const [id, init] of gesture.initial) {
            ctx.editor.updateShape(id, { x: init.x + dx, y: init.y + dy });
          }
          break;
        }
        case 'resize': {
          const nb = computeResizeBounds(
            gesture.initial,
            gesture.util,
            gesture.handle,
            info.point,
            info.shiftKey,
          );
          const r = gesture.util.resize(gesture.initial as never, nb);
          ctx.editor.updateShape(gesture.initial.id, {
            x: r.x,
            y: r.y,
            props: r.props as unknown as Record<string, unknown>,
          });
          break;
        }
        case 'group-resize': {
          const b0 = gesture.bounds0;
          const nb = axisAlignedResize(b0, gesture.handle, info.point, info.shiftKey);
          // Scale factors and the fixed (anchor) side for each axis.
          const sx = (nb.maxX - nb.minX) / (b0.maxX - b0.minX || 1);
          const sy = (nb.maxY - nb.minY) / (b0.maxY - b0.minY || 1);
          const fixedX = gesture.handle.includes('w') ? b0.maxX : b0.minX;
          const fixedY = gesture.handle.includes('n') ? b0.maxY : b0.minY;
          for (const item of gesture.items) {
            const sb: Bounds = {
              minX: fixedX + (item.b0.minX - fixedX) * sx,
              maxX: fixedX + (item.b0.maxX - fixedX) * sx,
              minY: fixedY + (item.b0.minY - fixedY) * sy,
              maxY: fixedY + (item.b0.maxY - fixedY) * sy,
            };
            const r = item.util.resize(item.initial as never, sb);
            ctx.editor.updateShape(item.initial.id, {
              x: r.x,
              y: r.y,
              props: r.props as unknown as Record<string, unknown>,
            });
          }
          break;
        }
        case 'handle': {
          const shape = ctx.editor.getShape(gesture.shapeId);
          if (!shape || !gesture.util.onHandleDrag) break;
          const r = gesture.util.onHandleDrag(
            shape as never,
            gesture.handleId,
            info.point,
            { shiftKey: info.shiftKey },
          );
          const patch: { x?: number; y?: number; props?: Record<string, unknown> } = {};
          if (r.x !== undefined) patch.x = r.x;
          if (r.y !== undefined) patch.y = r.y;
          if (r.props) patch.props = r.props as unknown as Record<string, unknown>;
          ctx.editor.updateShape(gesture.shapeId, patch);
          break;
        }
        case 'rotate': {
          const angle = Math.atan2(
            info.point.y - gesture.center.y,
            info.point.x - gesture.center.x,
          );
          let next = gesture.initial.rotation + (angle - gesture.startAngle);
          if (info.shiftKey) next = Math.round(next / ROTATE_SNAP) * ROTATE_SNAP;
          ctx.editor.updateShape(gesture.initial.id, { rotation: next });
          break;
        }
        case 'marquee': {
          const rect: Bounds = {
            minX: Math.min(gesture.start.x, info.point.x),
            minY: Math.min(gesture.start.y, info.point.y),
            maxX: Math.max(gesture.start.x, info.point.x),
            maxY: Math.max(gesture.start.y, info.point.y),
          };
          useSelectionStore.getState().setMarquee(rect);
          const entered = useEnteredGroupStore.getState().enteredGroupId;
          const found = spatialIndex
            .search(rect)
            .filter((id) => {
              const s = ctx.editor.getShape(id);
              return s ? isSelectable(s) : false;
            })
            // Selecting any group member selects the whole group.
            .map((id) => selectionTargetId(ctx.editor.getShape, id, entered));
          useSelectionStore
            .getState()
            .setSelection([...new Set([...gesture.base, ...found])]);
          break;
        }
      }
    },

    onPointerUp(_info: ToolPointerInfo, ctx: ToolContext) {
      const wasMove = gesture?.type === 'move';
      useSelectionStore.getState().setMarquee(null);
      useSelectionStore.getState().setSnapGuides([]);
      gesture = null;
      if (!wasMove) return;

      // Drop directly-moved leaves into / out of frames (under their center).
      const shapes = ctx.editor.getShapes();
      for (const id of useSelectionStore.getState().selectedIds) {
        const s = ctx.editor.getShape(id);
        if (!s || isContainerType(s.type)) continue;
        const parent = s.parentId ? ctx.editor.getShape(s.parentId) : null;
        // Keep group membership; only frame parenting follows the drag.
        if (parent && parent.type === 'group') continue;
        const util = shapeRegistry.getFor(s);
        if (!util) continue;
        const c = boundsCenter(util.getBounds(s));
        const next = topFrameAt(shapes, c, id);
        if ((s.parentId ?? null) !== (next ?? null)) {
          ctx.editor.updateShape(id, { parentId: next });
        }
      }
    },

    // Pinch-to-zoom (or any interrupt) mid-gesture: revert the in-progress
    // move/resize/rotate/handle drag to its pre-gesture state so an accidental
    // partial drag never sticks. A marquee just drops (it mutated no shape).
    onCancel(ctx: ToolContext) {
      const g = gesture;
      gesture = null;
      useSelectionStore.getState().setMarquee(null);
      useSelectionStore.getState().setSnapGuides([]);
      if (!g) return;
      const restore = (s: Shape) =>
        ctx.editor.updateShape(s.id, {
          x: s.x,
          y: s.y,
          rotation: s.rotation,
          props: s.props as unknown as Record<string, unknown>,
        });
      switch (g.type) {
        case 'move':
          for (const [id, init] of g.initial) {
            ctx.editor.updateShape(id, { x: init.x, y: init.y });
          }
          break;
        case 'resize':
        case 'rotate':
        case 'handle':
          restore(g.initial);
          break;
        case 'group-resize':
          for (const item of g.items) restore(item.initial);
          break;
        case 'marquee':
          break;
      }
    },

    onDoubleClick(info: ToolPointerInfo, ctx: ToolContext) {
      const zoom = useCameraStore.getState().camera.z;
      const shapes = ctx.editor.getShapes();
      // Double-click a text → edit it.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]!;
        if (s.type !== 'text' || !isSelectable(s)) continue;
        const util = shapeRegistry.getFor(s);
        if (util?.hitTest(s, info.point, SHAPE_HIT_SCREEN / zoom)) {
          useTextEditingStore.getState().start(s.id);
          return;
        }
      }
      // Otherwise double-click a group → step into it.
      const hitLeaf = topmostHit(shapes, info.point, SHAPE_HIT_SCREEN / zoom);
      if (!hitLeaf) return;
      const entered = useEnteredGroupStore.getState().enteredGroupId;
      const target = selectionTargetId(ctx.editor.getShape, hitLeaf, entered);
      if (ctx.editor.getShape(target)?.type === 'group') {
        useEnteredGroupStore.getState().enter(target);
        const inner = selectionTargetId(ctx.editor.getShape, hitLeaf, target);
        useSelectionStore.getState().setSelection([inner]);
      }
    },
  };
}

/** Topmost frame whose rectangle contains world point `p`, excluding `excludeId`. */
function topFrameAt(shapes: Shape[], p: Point, excludeId: string): string | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i]!;
    if (s.type !== 'frame' || s.id === excludeId) continue;
    if (
      p.x >= s.x &&
      p.x <= s.x + s.props.w &&
      p.y >= s.y &&
      p.y <= s.y + s.props.h
    ) {
      return s.id;
    }
  }
  return null;
}
