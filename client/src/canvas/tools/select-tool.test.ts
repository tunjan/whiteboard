import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
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
      'shiftKey' | 'altKey' | 'ctrlKey' | 'metaKey'
    >
  > = {},
): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: 'mouse',
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
});
