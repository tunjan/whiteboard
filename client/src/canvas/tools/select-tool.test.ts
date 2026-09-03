import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rotatePoint, type Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { getSelectionInfo, shapeRotatedBounds } from '../selection-geometry';
import { spatialIndex } from '../use-document-store';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { createSelectTool } from './select-tool';
import type { ToolContext, ToolPointerInfo } from './types';

function rectangle(
  id: string,
  x: number,
  y: number,
  index: string,
): Extract<Shape, { type: 'rectangle' }> {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    rotation: 0,
    index,
    props: {
      w: 40,
      h: 30,
      color: '#111',
      fillStyle: 'solid',
      dash: 'solid',
      size: 2,
    },
  };
}

function group(id: string, index: string): Extract<Shape, { type: 'group' }> {
  return {
    id,
    type: 'group',
    x: 0,
    y: 0,
    rotation: 0,
    index,
    props: {},
  };
}

function frame(
  id: string,
  x: number,
  y: number,
  index: string,
): Extract<Shape, { type: 'frame' }> {
  return {
    id,
    type: 'frame',
    x,
    y,
    rotation: 0,
    index,
    props: { w: 100, h: 100, name: 'Frame' },
  };
}

function pointer(
  x: number,
  y: number,
  keys: Partial<
    Pick<
      ToolPointerInfo,
      'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey' | 'pointerType'
    >
  > = {},
): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: keys.pointerType ?? 'mouse',
    shiftKey: keys.shiftKey ?? false,
    altKey: keys.altKey ?? false,
    ctrlKey: keys.ctrlKey ?? false,
    metaKey: keys.metaKey ?? false,
    button: 0,
  };
}

function context(initial: Shape[]): {
  ctx: ToolContext;
  shapes: Map<string, Shape>;
  transactions: { count: number };
} {
  const shapes = new Map(initial.map((shape) => [shape.id, shape]));
  for (const shape of initial) {
    if (shape.type !== 'group') spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
  }
  // Tracks how many top-level batches ran, so tests can assert a multi-shape
  // drag commits as a single transaction (one re-render) rather than one per shape.
  const transactions = { count: 0 };
  let depth = 0;
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()].sort((a, b) => a.index.localeCompare(b.index)),
    createShape: (shape) => shapes.set(shape.id, shape),
    updateShape: (id, patch) => {
      if (depth === 0) transactions.count++;
      const current = shapes.get(id);
      if (!current) return;
      const next = {
        ...current,
        ...patch,
        props: patch.props ? { ...current.props, ...patch.props } : current.props,
      } as Shape;
      shapes.set(id, next);
      if (next.type !== 'group') spatialIndex.insert(id, shapeRotatedBounds(next));
    },
    deleteShapes: (ids) => {
      for (const id of ids) {
        shapes.delete(id);
        spatialIndex.remove(id);
      }
    },
    transact: (fn) => {
      if (depth === 0) transactions.count++;
      depth++;
      try {
        fn();
      } finally {
        depth--;
      }
    },
  };
  return {
    ctx: { editor, setTool: () => undefined, complete: () => undefined },
    shapes,
    transactions,
  };
}

describe('select tool state machine', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useSelectionStore.getState().clear();
    useSelectionStore.getState().setMarquee(null);
    useSelectionStore.getState().setSnapGuides([]);
    useSelectionStore.getState().setRotationCursor(null);
    useEnteredGroupStore.getState().exit();
    useCanvasUiStore.getState().setSnappingEnabled(true);
  });

  afterEach(() => spatialIndex.clear());

  it('toggles with Shift-click but constrains a Shift-drag of an existing selection', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const b = rectangle('b', 80, 0, 'a1');
    const { ctx, shapes } = context([a, b]);
    const tool = createSelectTool();

    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerUp?.(pointer(10, 10), ctx);
    tool.onPointerDown?.(pointer(90, 10, { shiftKey: true }), ctx);
    tool.onPointerUp?.(pointer(90, 10, { shiftKey: true }), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['a', 'b']);

    useSelectionStore.getState().setSelection(['a']);
    tool.onPointerDown?.(pointer(10, 10, { shiftKey: true }), ctx);
    tool.onPointerMove?.(pointer(50, 30, { shiftKey: true, altKey: true }), ctx);
    tool.onPointerUp?.(pointer(50, 30, { shiftKey: true, altKey: true }), ctx);

    expect(shapes.get('a')?.x).toBe(40);
    expect(shapes.get('a')?.y).toBe(0);
  });

  it('keeps a drag on commit but reverts it on cancel', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const { ctx, shapes } = context([a]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    // A spurious pen pointercancel mid-drag commits: the moved position stays.
    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerMove?.(pointer(40, 10, { altKey: true }), ctx);
    tool.onCommit?.(ctx);
    expect(shapes.get('a')?.x).toBe(30);

    // A genuine cancel (pinch) reverts to the pre-gesture position.
    tool.onPointerDown?.(pointer(40, 10), ctx);
    tool.onPointerMove?.(pointer(70, 10, { altKey: true }), ctx);
    tool.onCancel?.(ctx);
    expect(shapes.get('a')?.x).toBe(30);
  });

  it('intersects in either direction and uses Ctrl/Command for wrap selection', () => {
    const root = group('group', 'a0');
    const first = { ...rectangle('first', 0, 0, 'a1'), parentId: root.id };
    const second = { ...rectangle('second', 70, 0, 'a2'), parentId: root.id };
    const { ctx } = context([root, first, second]);
    const tool = createSelectTool();

    tool.onPointerDown?.(pointer(-10, -10), ctx);
    tool.onPointerMove?.(pointer(50, 50), ctx);
    tool.onPointerUp?.(pointer(50, 50), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['group']);

    tool.onPointerDown?.(pointer(130, 50), ctx);
    tool.onPointerMove?.(pointer(-10, -10), ctx);
    tool.onPointerUp?.(pointer(-10, -10), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['group']);

    tool.onPointerDown?.(pointer(-10, -10), ctx);
    tool.onPointerMove?.(pointer(50, 50, { ctrlKey: true }), ctx);
    tool.onPointerUp?.(pointer(50, 50, { ctrlKey: true }), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual([]);

    tool.onPointerDown?.(pointer(-10, -10), ctx);
    tool.onPointerMove?.(pointer(120, 50, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(120, 50, { metaKey: true }), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['group']);
  });

  it('re-tests the live marquee when selection modifiers change', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const existing = rectangle('existing', 100, 0, 'a1');
    const { ctx } = context([a, existing]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['existing']);

    tool.onPointerDown?.(pointer(-10, -10), ctx);
    tool.onPointerMove?.(pointer(20, 20, { shiftKey: true }), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['existing', 'a']);

    tool.onKeyUp?.(
      {
        key: 'Shift',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as KeyboardEvent,
      ctx,
    );
    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);

    tool.onKeyDown?.(
      {
        key: 'Control',
        shiftKey: false,
        ctrlKey: true,
        metaKey: false,
      } as KeyboardEvent,
      ctx,
    );
    expect(useSelectionStore.getState().selectedIds).toEqual([]);

    tool.onKeyUp?.(
      {
        key: 'Control',
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
      } as KeyboardEvent,
      ctx,
    );
    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);

    tool.onPointerUp?.(pointer(20, 20), ctx);
  });

  it('ignores clipped descendants when the marquee does not reach their frame', () => {
    const parent = frame('frame', 0, 0, 'a0');
    const clipped = {
      ...rectangle('clipped', 120, 0, 'a1'),
      parentId: parent.id,
    };
    const { ctx } = context([parent, clipped]);
    const tool = createSelectTool();

    tool.onPointerDown?.(pointer(115, -5), ctx);
    tool.onPointerMove?.(pointer(165, 35), ctx);
    tool.onPointerUp?.(pointer(165, 35), ctx);

    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('does not publish an unchanged selection set again', () => {
    let selectionUpdates = 0;
    const unsubscribe = useSelectionStore.subscribe((next, previous) => {
      if (next.selectedIds !== previous.selectedIds) selectionUpdates++;
    });

    useSelectionStore.getState().setSelection(['a', 'b']);
    useSelectionStore.getState().setSelection(['a', 'b']);
    useSelectionStore.getState().setSelection(['b', 'a']);

    unsubscribe();
    expect(selectionUpdates).toBe(1);
  });

  it('clears selection only after an empty click completes', () => {
    const { ctx } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    tool.onPointerDown?.(pointer(100, 100), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);
    tool.onPointerUp?.(pointer(100, 100), ctx);
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('reparents direct leaves into frames without changing their page-space coordinates', () => {
    const leaf = rectangle('leaf', 0, 0, 'a0');
    const target = frame('frame', 100, 0, 'a1');
    const { ctx, shapes } = context([leaf, target]);
    const tool = createSelectTool();

    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerMove?.(pointer(130, 30, { altKey: true }), ctx);
    tool.onPointerUp?.(pointer(130, 30, { altKey: true }), ctx);

    expect(shapes.get('leaf')).toMatchObject({ x: 120, y: 20, parentId: 'frame' });
  });

  it('commits a multi-shape drag as a single transaction per frame', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const b = rectangle('b', 80, 0, 'a1');
    const c = rectangle('c', 160, 0, 'a2');
    const { ctx, shapes, transactions } = context([a, b, c]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a', 'b', 'c']);

    tool.onPointerDown?.(pointer(10, 10), ctx);
    transactions.count = 0;
    // Two move frames, three shapes each: one transaction per frame, not per shape.
    tool.onPointerMove?.(pointer(30, 10, { altKey: true }), ctx);
    tool.onPointerMove?.(pointer(50, 10, { altKey: true }), ctx);
    tool.onPointerUp?.(pointer(50, 10, { altKey: true }), ctx);

    expect(transactions.count).toBe(2);
    expect(shapes.get('a')?.x).toBe(40);
    expect(shapes.get('b')?.x).toBe(120);
    expect(shapes.get('c')?.x).toBe(200);
  });

  it('resizes a rotated multi-selection along the box axes, not the page axes', () => {
    const a = { ...rectangle('a', 0, 0, 'a0'), rotation: Math.PI / 2 };
    const b = { ...rectangle('b', 80, 0, 'a1'), rotation: Math.PI / 2 };
    const { ctx, shapes } = context([a, b]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a', 'b']);
    const info = getSelectionInfo([a, b], ['a', 'b'], 1)!;
    const east = info.handles.find((handle) => handle.id === 'e')!.point;
    // The box's own +x runs along page +y here, so widening it means dragging
    // the east handle downwards.
    tool.onPointerDown?.(pointer(east.x, east.y), ctx);
    tool.onPointerMove?.(pointer(east.x, east.y + 40), ctx);
    tool.onPointerUp?.(pointer(east.x, east.y + 40), ctx);

    // Both shapes span the box's full width, so both double along it and
    // neither changes along the other axis.
    for (const id of ['a', 'b']) {
      const props = shapes.get(id)!.props as { w: number; h: number };
      expect(props.w).toBeCloseTo(80);
      expect(props.h).toBeCloseTo(30);
    }
    const after = getSelectionInfo(
      [shapes.get('a')!, shapes.get('b')!],
      ['a', 'b'],
      1,
    )!;
    expect(after.alignedBounds.maxX - after.alignedBounds.minX).toBeCloseTo(80);
    expect(after.alignedBounds.maxY - after.alignedBounds.minY).toBeCloseTo(110);
  });

  it('widens a quarter-turned member across its own height', () => {
    const a = rectangle('a', 0, 0, 'a0');
    // A right-angled neighbour drops the shared rotation to zero, so the box is
    // page-aligned while this member's own axes are swapped inside it.
    const b = { ...rectangle('b', 80, 0, 'a1'), rotation: Math.PI / 2 };
    const { ctx, shapes } = context([a, b]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a', 'b']);
    const info = getSelectionInfo([a, b], ['a', 'b'], 1)!;
    const east = info.handles.find((handle) => handle.id === 'e')!.point;
    const width = info.bounds.maxX - info.bounds.minX;

    tool.onPointerDown?.(pointer(east.x, east.y), ctx);
    const target = info.bounds.minX + width * 2;
    tool.onPointerMove?.(pointer(target, east.y, { altKey: true }), ctx);
    tool.onPointerUp?.(pointer(target, east.y, { altKey: true }), ctx);

    // `b` shows its height to the page, so doubling the box's width has to
    // double `h` and leave `w` alone.
    expect(shapes.get('b')?.props).toMatchObject({ w: 40, h: 60 });
    expect(shapes.get('a')?.props).toMatchObject({ w: 80, h: 30 });
  });

  it('scales an off-axis member uniformly rather than shearing it', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const b = { ...rectangle('b', 80, 0, 'a1'), rotation: Math.PI / 4 };
    const { ctx, shapes } = context([a, b]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a', 'b']);
    const info = getSelectionInfo([a, b], ['a', 'b'], 1)!;
    const east = info.handles.find((handle) => handle.id === 'e')!.point;
    const target = info.bounds.minX + (info.bounds.maxX - info.bounds.minX) * 2;

    tool.onPointerDown?.(pointer(east.x, east.y), ctx);
    tool.onPointerMove?.(pointer(target, east.y, { altKey: true }), ctx);
    tool.onPointerUp?.(pointer(target, east.y, { altKey: true }), ctx);

    // A width-only drag cannot stretch a 45° shape without shearing it, so it
    // keeps its proportions and takes the smaller factor on both axes.
    const props = shapes.get('b')!.props as { w: number; h: number };
    expect(props.w / props.h).toBeCloseTo(40 / 30);
    expect(props.w).toBeCloseTo(40);
  });

  it('resizes from where the handle was grabbed, not where the cursor is', () => {
    const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    // Grabbed 3px outside the east edge; the edge should follow the drag, not
    // jump to meet the cursor.
    tool.onPointerDown?.(pointer(43, 15), ctx);
    tool.onPointerMove?.(pointer(53, 15, { altKey: true }), ctx);
    tool.onPointerUp?.(pointer(53, 15, { altKey: true }), ctx);

    expect(shapes.get('a')?.props).toMatchObject({ w: 50, h: 30 });
  });

  it('does not snap or show guides when snapping is disabled', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const target = rectangle('target', 80, 0, 'a1');
    const { ctx, shapes } = context([a, target]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);
    useCanvasUiStore.getState().setSnappingEnabled(false);

    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerMove?.(pointer(47, 10), ctx);
    tool.onPointerUp?.(pointer(47, 10), ctx);

    expect(shapes.get('a')?.x).toBe(37);
    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });

  it('rolls back an interrupted live drag to the gesture snapshot', () => {
    const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();

    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerMove?.(pointer(50, 10, { altKey: true }), ctx);
    expect(shapes.get('a')?.x).toBe(40);
    tool.onCancel?.(ctx);

    expect(shapes.get('a')).toMatchObject({ x: 0, y: 0 });
    expect(useSelectionStore.getState().selectedIds).toEqual([]);
  });

  it('rotates from an exterior corner target', () => {
    const shape = rectangle('a', 0, 0, 'a0');
    const { ctx, shapes } = context([shape]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection([shape.id]);
    const info = getSelectionInfo([shape], [shape.id], 1)!;
    const handle = info.rotationHandles[0]!.point;
    const dx = handle.x - info.center.x;
    const dy = handle.y - info.center.y;

    tool.onPointerDown?.(pointer(handle.x, handle.y), ctx);
    tool.onPointerMove?.(
      pointer(info.center.x - dy, info.center.y + dx),
      ctx,
    );
    tool.onPointerUp?.(
      pointer(info.center.x - dy, info.center.y + dx),
      ctx,
    );

    expect(shapes.get(shape.id)?.rotation).toBeCloseTo(Math.PI / 2);
  });

  it('rotates a parented multi-selection as one rigid body', () => {
    const parent = frame('frame', -100, -100, 'a0');
    const first = { ...rectangle('first', 0, 0, 'a1'), parentId: parent.id };
    const second = { ...rectangle('second', 80, 0, 'a2'), parentId: parent.id };
    const { ctx, shapes, transactions } = context([parent, first, second]);
    const tool = createSelectTool();
    useSelectionStore
      .getState()
      .setSelection([first.id, second.id]);
    const info = getSelectionInfo(
      [parent, first, second],
      [first.id, second.id],
      1,
    )!;
    const handle = info.rotationHandles[0]!.point;
    const target = rotatePoint(handle, info.center, Math.PI / 2);
    const firstCenter = { x: first.x + 20, y: first.y + 15 };
    const secondCenter = { x: second.x + 20, y: second.y + 15 };
    const expectedFirstCenter = rotatePoint(
      firstCenter,
      info.center,
      Math.PI / 2,
    );
    const expectedSecondCenter = rotatePoint(
      secondCenter,
      info.center,
      Math.PI / 2,
    );

    tool.onPointerDown?.(pointer(handle.x, handle.y), ctx);
    const initialCursor = useSelectionStore.getState().rotationCursor;
    transactions.count = 0;
    tool.onPointerMove?.(pointer(target.x, target.y), ctx);

    expect(transactions.count).toBe(1);
    expect(useSelectionStore.getState().rotationCursor).not.toBe(initialCursor);
    expect(shapes.get(first.id)).toMatchObject({
      parentId: parent.id,
      x: expectedFirstCenter.x - 20,
      y: expectedFirstCenter.y - 15,
    });
    expect(shapes.get(second.id)).toMatchObject({
      parentId: parent.id,
      x: expectedSecondCenter.x - 20,
      y: expectedSecondCenter.y - 15,
    });
    expect(shapes.get(first.id)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(shapes.get(second.id)?.rotation).toBeCloseTo(Math.PI / 2);

    tool.onPointerUp?.(pointer(target.x, target.y), ctx);
    expect(useSelectionStore.getState().rotationCursor).toBeNull();
  });

  it('uses the gesture snapshot instead of accumulating rotation drift', () => {
    const first = rectangle('first', 0, 0, 'a0');
    const second = rectangle('second', 80, 0, 'a1');
    const { ctx, shapes } = context([first, second]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection([first.id, second.id]);
    const info = getSelectionInfo(
      [first, second],
      [first.id, second.id],
      1,
    )!;
    const handle = info.rotationHandles[2]!.point;
    const halfway = rotatePoint(handle, info.center, Math.PI / 4);
    const target = rotatePoint(handle, info.center, Math.PI / 2);

    tool.onPointerDown?.(pointer(handle.x, handle.y), ctx);
    tool.onPointerMove?.(pointer(halfway.x, halfway.y), ctx);
    tool.onPointerMove?.(pointer(target.x, target.y), ctx);
    tool.onPointerUp?.(pointer(target.x, target.y), ctx);

    expect(shapes.get(first.id)).toMatchObject({ x: 40, y: -40 });
    expect(shapes.get(second.id)).toMatchObject({ x: 40, y: 40 });
  });

  it('snaps Shift rotation to 15 degrees and rounds free rotation on drop', () => {
    const shiftShape = rectangle('shift', 0, 0, 'a0');
    const freeShape = rectangle('free', 100, 0, 'a1');
    const { ctx, shapes } = context([shiftShape, freeShape]);
    const tool = createSelectTool();
    const requested = (22.4 * Math.PI) / 180;

    useSelectionStore.getState().setSelection([shiftShape.id]);
    const shiftInfo = getSelectionInfo([shiftShape], [shiftShape.id], 1)!;
    const shiftHandle = shiftInfo.rotationHandles[0]!.point;
    const shiftTarget = rotatePoint(shiftHandle, shiftInfo.center, requested);
    tool.onPointerDown?.(
      pointer(shiftHandle.x, shiftHandle.y, { shiftKey: true }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(shiftTarget.x, shiftTarget.y, { shiftKey: true }),
      ctx,
    );
    tool.onPointerUp?.(
      pointer(shiftTarget.x, shiftTarget.y, { shiftKey: true }),
      ctx,
    );
    expect(shapes.get(shiftShape.id)?.rotation).toBeCloseTo(
      (15 * Math.PI) / 180,
    );

    useSelectionStore.getState().setSelection([freeShape.id]);
    const freeInfo = getSelectionInfo([freeShape], [freeShape.id], 1)!;
    const freeHandle = freeInfo.rotationHandles[0]!.point;
    const freeTarget = rotatePoint(freeHandle, freeInfo.center, requested);
    tool.onPointerDown?.(pointer(freeHandle.x, freeHandle.y), ctx);
    tool.onPointerMove?.(pointer(freeTarget.x, freeTarget.y), ctx);
    expect(shapes.get(freeShape.id)?.rotation).toBeCloseTo(requested);
    tool.onPointerUp?.(pointer(freeTarget.x, freeTarget.y), ctx);
    expect(shapes.get(freeShape.id)?.rotation).toBeCloseTo(
      (22 * Math.PI) / 180,
    );
  });

  it('magnetizes coarse touch rotation to nearby right angles', () => {
    const shape = rectangle('touch', 0, 0, 'a0');
    const { ctx, shapes } = context([shape]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection([shape.id]);
    const info = getSelectionInfo([shape], [shape.id], 1)!;
    const handle = info.rotationHandles[0]!.point;
    const target = rotatePoint(handle, info.center, (87 * Math.PI) / 180);

    tool.onPointerDown?.(
      pointer(handle.x, handle.y, { pointerType: 'touch' }),
      ctx,
    );
    tool.onPointerMove?.(
      pointer(target.x, target.y, { pointerType: 'touch' }),
      ctx,
    );

    expect(shapes.get(shape.id)?.rotation).toBeCloseTo(Math.PI / 2);
    tool.onCancel?.(ctx);
    expect(shapes.get(shape.id)).toMatchObject({ x: 0, y: 0, rotation: 0 });
  });
});
