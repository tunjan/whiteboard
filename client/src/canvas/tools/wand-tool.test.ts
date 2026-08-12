import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Point, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { shapeRotatedBounds } from '../selection-geometry';
import { spatialIndex } from '../use-document-store';
import { useEnteredGroupStore } from '../use-entered-group-store';
import { useSelectionStore } from '../use-selection-store';
import { createWandTool } from './wand-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// The node test env has no rAF; the live-stroke flush is scheduled through it,
// but every path the wand takes writes synchronously at the end of a gesture.
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

function rectangle(
  id: string,
  x: number,
  y: number,
  index: string,
  parentId?: string,
): Extract<Shape, { type: 'rectangle' }> {
  return {
    id,
    type: 'rectangle',
    x,
    y,
    rotation: 0,
    index,
    ...(parentId ? { parentId } : {}),
    props: { w: 40, h: 30, color: '#111', fillStyle: 'solid', dash: 'solid', size: 2 },
  };
}

function pointer(x: number, y: number): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
  };
}

function context(initial: Shape[] = []): {
  ctx: ToolContext;
  shapes: Map<string, Shape>;
  completed: { count: number };
} {
  const shapes = new Map(initial.map((shape) => [shape.id, shape]));
  for (const shape of initial) {
    if (shape.type !== 'group') {
      spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
    }
  }
  const completed = { count: 0 };
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () =>
      [...shapes.values()].sort((a, b) => a.index.localeCompare(b.index)),
    createShape: (shape) => {
      shapes.set(shape.id, shape);
      if (shape.type !== 'group') {
        spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
      }
    },
    updateShape: (id, patch) => {
      const current = shapes.get(id);
      if (!current) return;
      shapes.set(id, {
        ...current,
        ...patch,
        props: patch.props ? { ...current.props, ...patch.props } : current.props,
      } as Shape);
    },
    deleteShapes: (ids) => {
      for (const id of ids) {
        shapes.delete(id);
        spatialIndex.remove(id);
      }
    },
    transact: (fn) => fn(),
  };
  return {
    ctx: {
      editor,
      setTool: () => undefined,
      complete: () => {
        completed.count++;
      },
    },
    shapes,
    completed,
  };
}

/** Points of a closed-ish circle, walked clockwise from its rightmost point. */
function circle(cx: number, cy: number, r: number, steps = 24): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) });
  }
  return points;
}

function stroke(tool: ReturnType<typeof createWandTool>, ctx: ToolContext, path: Point[]) {
  const [first, ...rest] = path;
  if (!first) return;
  tool.onPointerDown?.(pointer(first.x, first.y), ctx);
  for (const point of rest.slice(0, -1)) {
    tool.onPointerMove?.(pointer(point.x, point.y), ctx);
  }
  const last = rest[rest.length - 1] ?? first;
  tool.onPointerMove?.(pointer(last.x, last.y), ctx);
  tool.onPointerUp?.(pointer(last.x, last.y), ctx);
}

describe('magic wand', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useSelectionStore.getState().clear();
    useEnteredGroupStore.getState().exit();
  });

  afterEach(() => spatialIndex.clear());

  it('selects the shapes a loop encloses, leaving no ink behind', () => {
    const { ctx, shapes, completed } = context([rectangle('a', 80, 85, 'a0')]);
    const tool = createWandTool();

    stroke(tool, ctx, circle(100, 100, 60));

    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);
    // The lasso was a gesture, not a drawing.
    expect([...shapes.values()].map((s) => s.id)).toEqual(['a']);
    expect(completed.count).toBe(1);
  });

  it('leaves shapes the loop only crosses alone', () => {
    // The rectangle straddles the loop's edge: circling *past* something is not
    // circling it.
    const { ctx, shapes } = context([rectangle('a', 140, 85, 'a0')]);
    const tool = createWandTool();

    stroke(tool, ctx, circle(100, 100, 60));

    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    // Nothing was selected, so the loop is kept as ink.
    expect([...shapes.values()].some((s) => s.type === 'draw')).toBe(true);
  });

  it('keeps an open stroke as ink even when it wraps a shape', () => {
    const { ctx, shapes, completed } = context([rectangle('a', 80, 85, 'a0')]);
    const tool = createWandTool();

    // Three quarters of a circle: the ends are nowhere near each other, so this
    // is a drawn arc, not a loop.
    stroke(tool, ctx, circle(100, 100, 60).slice(0, 19));

    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    const ink = [...shapes.values()].filter((s) => s.type === 'draw');
    expect(ink).toHaveLength(1);
    expect(completed.count).toBe(0);
  });

  it('draws pen strokes: a short mark is kept and stays selectable ink', () => {
    const { ctx, shapes } = context();
    const tool = createWandTool();

    stroke(tool, ctx, [
      { x: 0, y: 0 },
      { x: 20, y: 10 },
      { x: 40, y: 0 },
    ]);

    const ink = [...shapes.values()].filter((s) => s.type === 'draw');
    expect(ink).toHaveLength(1);
    expect(ink[0]?.type === 'draw' && ink[0].props.points.length).toBeGreaterThan(1);
  });

  it('leaves no ink behind when a lasso long enough to be chunked selects', () => {
    // Past the draw tool's point cap the stroke continues in a second shape.
    // The wand used to track only the shape most recently created, so the
    // first chunk survived the selection as stray, untracked ink.
    const { ctx, shapes } = context([rectangle('a', 380, 385, 'a0')]);
    const tool = createWandTool();

    stroke(tool, ctx, circle(400, 400, 360, 800));

    expect(useSelectionStore.getState().selectedIds).toEqual(['a']);
    expect([...shapes.values()].filter((s) => s.type === 'draw')).toEqual([]);
  });

  it('commits every chunk of a long stroke that is kept as ink', () => {
    const { ctx, shapes } = context();
    const tool = createWandTool();

    // An open arc, so it stays ink — and long enough to have been split.
    stroke(tool, ctx, circle(400, 400, 360, 800).slice(0, 601));

    const ink = [...shapes.values()].filter((s) => s.type === 'draw');
    expect(ink.length).toBeGreaterThan(1);
  });

  it('selects a group only when the loop goes round all of it', () => {
    const grouped = (): Shape[] => [
      {
        id: 'g',
        type: 'group',
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a0',
        props: {},
      } as Shape,
      rectangle('a', 80, 85, 'a1', 'g'),
      rectangle('b', 300, 85, 'a2', 'g'),
    ];

    // One member circled: a group is one object, so half of it is none of it.
    stroke(createWandTool(), context(grouped()).ctx, circle(100, 100, 60));
    expect(useSelectionStore.getState().selectedIds).toEqual([]);

    spatialIndex.clear();
    stroke(createWandTool(), context(grouped()).ctx, circle(190, 100, 200));
    expect(useSelectionStore.getState().selectedIds).toEqual(['g']);
  });

  it('discards the stroke and selects nothing when the gesture is cancelled', () => {
    const { ctx, shapes } = context([rectangle('a', 80, 85, 'a0')]);
    const tool = createWandTool();

    const path = circle(100, 100, 60);
    tool.onPointerDown?.(pointer(path[0]!.x, path[0]!.y), ctx);
    for (const point of path.slice(1)) {
      tool.onPointerMove?.(pointer(point.x, point.y), ctx);
    }
    tool.onCancel?.(ctx);

    expect(useSelectionStore.getState().selectedIds).toEqual([]);
    expect([...shapes.values()].map((s) => s.id)).toEqual(['a']);
  });
});
