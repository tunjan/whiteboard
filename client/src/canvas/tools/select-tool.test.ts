import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { rotatePoint, type Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { getSelectionInfo, shapeRotatedBounds } from '../selection-geometry';
import { spatialIndex } from '../use-document-store';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { useImageCroppingStore } from '../use-image-cropping-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { nextShapeStyle } from '../use-style-store';
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
    useSelectionStore.getState().setGestureCursor(null);
    useEnteredGroupStore.getState().exit();
    useCanvasUiStore.getState().setSnappingEnabled(true);
  });

  afterEach(() => spatialIndex.clear());

  it('binds a dragged arrow endpoint with snapping turned off', () => {
    useCanvasUiStore.getState().setSnappingEnabled(false);
    const arrow = {
      id: 'arrow',
      type: 'arrow',
      x: 0,
      y: 15,
      rotation: 0,
      index: 'a1',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: '#111',
        size: 2,
        dash: 'solid',
        arrowStart: false,
        arrowEnd: true,
        bend: 0,
        topology: 'straight',
        bindings: {},
        label: '',
      },
    } as Shape;
    const { ctx, shapes } = context([rectangle('r', 200, 0, 'a0'), arrow]);
    useSelectionStore.getState().setSelection(['arrow']);

    const tool = createSelectTool();
    tool.onPointerDown?.(pointer(100, 15), ctx);
    tool.onPointerMove?.(pointer(215, 15), ctx);
    tool.onPointerUp?.(pointer(215, 15), ctx);

    const moved = shapes.get('arrow') as Extract<Shape, { type: 'arrow' }>;
    expect(moved.props.bindings?.end?.shapeId).toBe('r');
  });

  // Selecting is not a way of picking up a style. Clicking a red rectangle used
  // to write its colour into the store, so the next stroke came out red; the
  // bar now reads the selection instead, and the style new shapes inherit only
  // moves when a control does.
  it('leaves the style new shapes inherit alone when a shape is selected', () => {
    const red = rectangle('a', 0, 0, 'a0');
    red.props.color = '#e03131';
    red.props.size = 10;
    const { ctx } = context([red]);
    const before = nextShapeStyle();

    const tool = createSelectTool();
    tool.onPointerDown?.(pointer(10, 10), ctx);
    tool.onPointerUp?.(pointer(10, 10), ctx);

    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);
    expect(nextShapeStyle()).toEqual(before);
  });

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

  it('drills into an unentered group on double-click before editing a member', () => {
    const image = {
      id: 'img',
      type: 'image',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a1',
      parentId: 'g',
      props: { blobId: '', w: 40, h: 30, naturalWidth: 40, naturalHeight: 30 },
    } as Shape;
    const sibling = { ...rectangle('r', 100, 0, 'a2'), parentId: 'g' };
    const { ctx } = context([group('g', 'a0'), image, sibling]);
    const tool = createSelectTool();
    useEnteredGroupStore.getState().exit();
    useImageCroppingStore.getState().stop();

    tool.onDoubleClick?.(pointer(20, 15), ctx);
    expect(useEnteredGroupStore.getState().enteredGroupId).toBe('g');
    expect(useSelectionStore.getState().selectedIds).toEqual(['img']);
    expect(useImageCroppingStore.getState().croppingId).toBeNull();

    tool.onDoubleClick?.(pointer(20, 15), ctx);
    expect(useImageCroppingStore.getState().croppingId).toBe('img');
    useImageCroppingStore.getState().stop();
    useEnteredGroupStore.getState().exit();
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
    // Command suspends snapping for the drag; Alt would resize from the centre.
    tool.onPointerMove?.(pointer(target, east.y, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(target, east.y, { metaKey: true }), ctx);

    // `b` shows its height to the page, so doubling the box's width has to
    // double `h` and leave `w` alone.
    expect(shapes.get('b')?.props).toMatchObject({ w: 40, h: 60 });
    expect(shapes.get('a')?.props).toMatchObject({ w: 80, h: 30 });
  });

  it('pins the whole gesture to a uniform scale when a member is off-axis', () => {
    const a = rectangle('a', 0, 0, 'a0');
    const b = { ...rectangle('b', 80, 0, 'a1'), rotation: Math.PI / 4 };
    const { ctx, shapes } = context([a, b]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a', 'b']);
    const info = getSelectionInfo([a, b], ['a', 'b'], 1)!;
    const east = info.handles.find((handle) => handle.id === 'e')!.point;
    const target = info.bounds.minX + (info.bounds.maxX - info.bounds.minX) * 2;

    tool.onPointerDown?.(pointer(east.x, east.y), ctx);
    tool.onPointerMove?.(pointer(target, east.y, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(target, east.y, { metaKey: true }), ctx);

    // A width-only drag cannot stretch a 45° shape without shearing it. Rather
    // than let that member fall behind the rest of the selection, the drag
    // becomes uniform for everything in it: the width doubles, so does the
    // height, and every member keeps its proportions.
    const props = shapes.get('b')!.props as { w: number; h: number };
    expect(props.w / props.h).toBeCloseTo(40 / 30);
    expect(props.w).toBeCloseTo(80);
    expect(shapes.get('a')?.props).toMatchObject({ w: 80, h: 60 });
  });

  it('resizes from where the handle was grabbed, not where the cursor is', () => {
    const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    // Grabbed 3px outside the east edge; the edge should follow the drag, not
    // jump to meet the cursor.
    tool.onPointerDown?.(pointer(43, 15), ctx);
    tool.onPointerMove?.(pointer(53, 15, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(53, 15, { metaKey: true }), ctx);

    expect(shapes.get('a')?.props).toMatchObject({ w: 50, h: 30 });
  });

  it('keeps a mid-resize edit to props the resize does not own', () => {
    const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    tool.onPointerDown?.(pointer(43, 15), ctx);
    tool.onPointerMove?.(pointer(53, 15, { metaKey: true }), ctx);
    // A peer recolours the shape while the drag is still held.
    ctx.editor.updateShape('a', { props: { color: '#f00' } });
    tool.onPointerMove?.(pointer(63, 15, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(63, 15, { metaKey: true }), ctx);

    expect(shapes.get('a')?.props).toMatchObject({ w: 60, color: '#f00' });
  });

  it('carries a group’s members when resizing a selection that holds it', () => {
    const child = (id: string, x: number) => ({
      ...rectangle(id, x, 0, `a${id}`),
      parentId: 'g',
    });
    const { ctx, shapes } = context([
      rectangle('r', 0, 0, 'a0'),
      group('g', 'a1'),
      child('c1', 100),
      child('c2', 150),
    ]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['r', 'g']);
    const { maxX, maxY } = getSelectionInfo(
      ctx.editor.getShapes(),
      ['r', 'g'],
      1,
      ctx.editor.getShape,
    )!.bounds;

    tool.onPointerDown?.(pointer(maxX, maxY), ctx);
    tool.onPointerMove?.(pointer(maxX * 2, maxY * 2, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(maxX * 2, maxY * 2, { metaKey: true }), ctx);

    expect(shapes.get('c2')!.x).toBeGreaterThan(150);
    expect((shapes.get('c2')!.props as { w: number }).w).toBeGreaterThan(40);
  });

  it('resizes about the box centre while Alt is held', () => {
    const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0')]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);

    // The east edge goes from 40 to 60, twice as far from the centre at 20 —
    // so the west edge travels the same distance the other way.
    tool.onPointerDown?.(pointer(40, 15), ctx);
    tool.onPointerMove?.(pointer(60, 15, { altKey: true, metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(60, 15, { altKey: true, metaKey: true }), ctx);

    expect(shapes.get('a')).toMatchObject({ x: -20 });
    expect(shapes.get('a')?.props).toMatchObject({ w: 80, h: 30 });
  });

  it('mirrors a shape dragged past its own anchor instead of collapsing it', () => {
    // An L, so which way it faces is readable from the points alone.
    const stroke: Extract<Shape, { type: 'draw' }> = {
      id: 'a',
      type: 'draw',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 30 },
          { x: 40, y: 30 },
        ],
        isClosed: false,
        color: '#111',
        size: 1,
      },
    };
    const { ctx, shapes } = context([stroke]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection(['a']);
    const info = getSelectionInfo([stroke], ['a'], 1)!;
    const east = info.handles.find((handle) => handle.id === 'e')!.point;
    const width = info.bounds.maxX - info.bounds.minX;

    // Dragged a box-width past the west edge, so the box comes out the same
    // width again on the other side of the anchor it was pinned to.
    tool.onPointerDown?.(pointer(east.x, east.y), ctx);
    const target = info.bounds.minX - width;
    tool.onPointerMove?.(pointer(target, east.y, { metaKey: true }), ctx);
    tool.onPointerUp?.(pointer(target, east.y, { metaKey: true }), ctx);

    const after = shapes.get('a') as Extract<Shape, { type: 'draw' }>;
    const xs = after.props.points.map((point) => point.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(40);
    // The mirror is carried by the geometry, not by an inverted box: the foot
    // of the L that ran east now runs west.
    expect(after.props.points[2]!.x).toBeLessThan(after.props.points[0]!.x);
    // And the whole stroke has crossed the anchor it was pinned to.
    expect(shapeRotatedBounds(after).maxX).toBeCloseTo(info.bounds.minX);
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

  it('rotates from the knob and resizes from the corner beside it', () => {
    const shape = rectangle('a', 0, 0, 'a0');
    const { ctx, shapes } = context([shape]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection([shape.id]);
    const info = getSelectionInfo([shape], [shape.id], 1)!;
    const handle = info.rotateHandle!.point;
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

    // Just outside a corner is no longer a rotation zone: it resizes.
    const turned = shapes.get(shape.id)!;
    const cornerInfo = getSelectionInfo([turned], [turned.id], 1)!;
    const corner = cornerInfo.handles.find((h) => h.id === 'se')!.point;
    const outside = rotatePoint(
      { x: corner.x + 3, y: corner.y + 3 },
      corner,
      turned.rotation,
    );
    tool.onPointerDown?.(pointer(outside.x, outside.y), ctx);
    tool.onPointerMove?.(pointer(outside.x + 10, outside.y + 10), ctx);
    tool.onPointerUp?.(pointer(outside.x + 10, outside.y + 10), ctx);
    expect(shapes.get(shape.id)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(shapes.get(shape.id)).not.toMatchObject({ props: turned.props });
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
    const handle = info.rotateHandle!.point;
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
    transactions.count = 0;
    tool.onPointerMove?.(pointer(target.x, target.y), ctx);

    expect(transactions.count).toBe(1);
    expect(useSelectionStore.getState().gestureCursor).toBe('grabbing');
    expect(shapes.get(first.id)?.parentId).toBe(parent.id);
    expect(shapes.get(first.id)?.x).toBeCloseTo(expectedFirstCenter.x - 20);
    expect(shapes.get(first.id)?.y).toBeCloseTo(expectedFirstCenter.y - 15);
    expect(shapes.get(second.id)?.parentId).toBe(parent.id);
    expect(shapes.get(second.id)?.x).toBeCloseTo(expectedSecondCenter.x - 20);
    expect(shapes.get(second.id)?.y).toBeCloseTo(expectedSecondCenter.y - 15);
    expect(shapes.get(first.id)?.rotation).toBeCloseTo(Math.PI / 2);
    expect(shapes.get(second.id)?.rotation).toBeCloseTo(Math.PI / 2);

    tool.onPointerUp?.(pointer(target.x, target.y), ctx);
    expect(useSelectionStore.getState().gestureCursor).toBeNull();
  });

  it('promotes children a rotation swung clear of their frame', () => {
    const parent = {
      ...frame('frame', 0, 0, 'a0'),
      props: { w: 200, h: 60, name: 'Frame' },
    };
    const first = { ...rectangle('first', 0, 15, 'a1'), parentId: parent.id };
    const second = { ...rectangle('second', 160, 15, 'a2'), parentId: parent.id };
    const stay = { ...rectangle('stay', 80, 15, 'a3'), parentId: parent.id };
    const { ctx, shapes } = context([parent, first, second, stay]);
    const tool = createSelectTool();
    useSelectionStore.getState().setSelection([first.id, second.id]);
    const info = getSelectionInfo(
      [parent, first, second, stay],
      [first.id, second.id],
      1,
    )!;
    const handle = info.rotateHandle!.point;
    const target = rotatePoint(handle, info.center, Math.PI / 2);

    tool.onPointerDown?.(pointer(handle.x, handle.y), ctx);
    tool.onPointerMove?.(pointer(target.x, target.y), ctx);
    expect(shapes.get(first.id)?.parentId).toBe(parent.id);

    tool.onPointerUp?.(pointer(target.x, target.y), ctx);

    expect(shapes.get(first.id)?.parentId).toBeNull();
    expect(shapes.get(second.id)?.parentId).toBeNull();
    expect(shapes.get(stay.id)?.parentId).toBe(parent.id);
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
    const handle = info.rotateHandle!.point;
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
    const shiftHandle = shiftInfo.rotateHandle!.point;
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
    const freeHandle = freeInfo.rotateHandle!.point;
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
    const handle = info.rotateHandle!.point;
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

  describe('resizing straight and padded geometry', () => {
    const stroke = (id: string, x: number, points: { x: number; y: number }[], index = 'a0') =>
      ({
        id, type: 'draw', x, y: 0, rotation: 0, index,
        props: { points, isClosed: false, color: '#111', size: 4 },
      }) as Shape;
    const line = (id: string, points: { x: number; y: number }[], label: string) =>
      ({
        id, type: 'line', x: 0, y: 0, rotation: 0, index: 'a1',
        props: { points, color: '#111', size: 4, dash: 'solid', bend: 0, spline: 'linear', label },
      }) as Shape;
    /** Page extent of the shape's own points, without the bounds margin. */
    const span = (s: Shape) => {
      const pts = (s.props as { points: { x: number; y: number }[] }).points;
      const xs = pts.map((p) => s.x + p.x);
      const ys = pts.map((p) => s.y + p.y);
      return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
    };
    const handleAt = (ctx: ToolContext, ids: string[], id: string) =>
      getSelectionInfo(ctx.editor.getShapes(), ids, 1, ctx.editor.getShape)!.handles.find((h) => h.id === id)!.point;

    beforeEach(() => useCanvasUiStore.getState().setSnappingEnabled(false));

    it('keeps a horizontal stroke on its line when a corner is dragged off it', () => {
      const { ctx, shapes } = context([stroke('a', 0, [{ x: 0, y: 0 }, { x: 100, y: 0 }])]);
      const tool = createSelectTool();
      useSelectionStore.getState().setSelection(['a']);
      const se = handleAt(ctx, ['a'], 'se');

      tool.onPointerDown?.(pointer(se.x, se.y), ctx);
      tool.onPointerMove?.(pointer(se.x + 100, se.y + 60), ctx);
      expect(span(shapes.get('a')!)).toMatchObject({ minX: 0, maxX: 200, minY: 0, maxY: 0 });
      // Shift has no second axis to keep in proportion: vertical jitter on a
      // 4px-tall box used to multiply the length.
      tool.onPointerMove?.(pointer(se.x, se.y + 10, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(se.x, se.y + 10, { shiftKey: true }), ctx);
      expect(span(shapes.get('a')!)).toMatchObject({ minX: 0, maxX: 100, minY: 0, maxY: 0 });
    });

    it('keeps an angle-snapped vertical stroke vertical', () => {
      // What the draw tool's Shift snap produces at 90°: cos(π/2) leaves ~7e-15 in x.
      const a = Math.PI / 2;
      const { ctx, shapes } = context([
        stroke('a', 0, [{ x: 37.3, y: 12 }, { x: 37.3 + Math.cos(a) * 100, y: 12 + Math.sin(a) * 100 }]),
      ]);
      const tool = createSelectTool();
      useSelectionStore.getState().setSelection(['a']);
      const se = handleAt(ctx, ['a'], 'se');

      tool.onPointerDown?.(pointer(se.x, se.y), ctx);
      tool.onPointerMove?.(pointer(se.x + 80, se.y + 50), ctx);
      tool.onPointerUp?.(pointer(se.x + 80, se.y + 50), ctx);

      const after = span(shapes.get('a')!);
      expect(after.minX).toBeCloseTo(37.3);
      expect(after.maxX - after.minX).toBeLessThan(1e-6);
      expect(after.maxY - after.minY).toBeCloseTo(150);
    });

    it('scales stroke and line geometry with the selection, not their margins', () => {
      const letter = (id: string, x: number, index: string) =>
        stroke(id, x, [{ x: 0, y: 0 }, { x: 6, y: 10 }, { x: 12, y: 0 }], index);
      const { ctx, shapes } = context([
        letter('a', 0, 'a0'),
        letter('b', 20, 'a2'),
        line('l', [{ x: 0, y: 40 }, { x: 200, y: 40 }], 'distance'),
      ]);
      const tool = createSelectTool();
      const ids = ['a', 'b', 'l'];
      useSelectionStore.getState().setSelection(ids);
      const se = handleAt(ctx, ids, 'se');
      const nw = handleAt(ctx, ids, 'nw');

      tool.onPointerDown?.(pointer(se.x, se.y), ctx);
      tool.onPointerMove?.(pointer((se.x + nw.x) / 2, (se.y + nw.y) / 2), ctx);
      tool.onPointerUp?.(pointer((se.x + nw.x) / 2, (se.y + nw.y) / 2), ctx);

      for (const id of ['a', 'b']) {
        const s = span(shapes.get(id)!);
        expect(s.maxX - s.minX).toBeCloseTo(6);
        expect(s.maxY - s.minY).toBeCloseTo(5);
      }
      expect(span(shapes.get('b')!).minX - span(shapes.get('a')!).minX).toBeCloseTo(10);
      const l = span(shapes.get('l')!);
      expect(l.maxX - l.minX).toBeCloseTo(100);
    });

    it('does not snap a rotated shape’s unrotated box to the page grid', () => {
      useCanvasUiStore.getState().setSnappingEnabled(true);
      const { ctx, shapes } = context([{ ...rectangle('a', 0, 0, 'a0'), rotation: Math.PI / 4 }]);
      const tool = createSelectTool();
      useSelectionStore.getState().setSelection(['a']);
      const e = handleAt(ctx, ['a'], 'e');
      const d = Math.SQRT1_2 * 3;

      tool.onPointerDown?.(pointer(e.x, e.y), ctx);
      tool.onPointerMove?.(pointer(e.x + d, e.y + d), ctx);
      tool.onPointerUp?.(pointer(e.x + d, e.y + d), ctx);

      expect((shapes.get('a')!.props as { w: number }).w).toBeCloseTo(43);
    });

    it('keeps the aspect ratio when a Shift edge drag snaps', () => {
      useCanvasUiStore.getState().setSnappingEnabled(true);
      const { ctx, shapes } = context([rectangle('a', 0, 0, 'a0'), rectangle('t', 82, 200, 'a1')]);
      const tool = createSelectTool();
      useSelectionStore.getState().setSelection(['a']);

      tool.onPointerDown?.(pointer(40, 15), ctx);
      tool.onPointerMove?.(pointer(80, 15, { shiftKey: true }), ctx);
      tool.onPointerUp?.(pointer(80, 15, { shiftKey: true }), ctx);

      const { w, h } = shapes.get('a')!.props as { w: number; h: number };
      expect(w).toBe(82);
      expect(w / h).toBeCloseTo(40 / 30);
    });
  });
});
