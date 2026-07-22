import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { DrawProps, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { createDrawTool } from './draw-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// The node test env has no rAF; the live-stroke flush is scheduled via it but
// finalize/cancel always write synchronously, so a no-op stub is enough.
beforeAll(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
});

function pointer(
  x: number,
  y: number,
  overrides: Partial<ToolPointerInfo> = {},
): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: 'pen',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
    ...overrides,
  };
}

function context(): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map<string, Shape>();
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (shape) => shapes.set(shape.id, shape),
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
      for (const id of ids) shapes.delete(id);
    },
    transact: (fn) => fn(),
  };
  return { ctx: { editor, setTool: () => undefined, complete: () => undefined }, shapes };
}

function drawPoints(shape: Shape | undefined): DrawProps['points'] | undefined {
  return shape?.type === 'draw' ? shape.props.points : undefined;
}

describe('draw tool stroke lifecycle', () => {
  it('onCommit keeps every sample, even ones the chord could describe', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
    tool.onPointerMove?.(pointer(20, 0), ctx);
    tool.onCommit?.(ctx);

    expect(shapes.size).toBe(1);
    const points = drawPoints([...shapes.values()][0]);
    // The midpoint here is collinear and so contributes nothing geometrically,
    // but it is still kept: perfect-freehand's `streamline` smooths over the
    // point sequence, so dropping a sample changes the rendered curve and the
    // stroke would visibly shift the moment the pointer lifts.
    expect(points?.length).toBe(3);
    expect(points?.[0]).toMatchObject({ x: 0, y: 0 });
    expect(points?.[1]).toMatchObject({ x: 10, y: 0 });
    expect(points?.[2]).toMatchObject({ x: 20, y: 0 });
  });

  it('onCommit preserves points that carry the curve', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 5), ctx);
    tool.onPointerMove?.(pointer(20, 0), ctx);
    tool.onCommit?.(ctx);

    const points = drawPoints([...shapes.values()][0]);
    expect(points?.length).toBe(3);
    expect(points?.[1]).toMatchObject({ x: 10, y: 5 });
  });

  it('samples a gesture identically at every zoom', () => {
    // Point density decides how much `streamline` smooths the stroke, so the
    // sampling gate must not depend on the camera — otherwise the same world
    // gesture renders differently depending on the zoom it was drawn at.
    const walk = (zoom: number) => {
      const { ctx, shapes } = context();
      const tool = createDrawTool();
      tool.onPointerDown?.(pointer(0, 0, { zoom }), ctx);
      for (let i = 1; i <= 40; i++) {
        tool.onPointerMove?.(pointer(i * 0.4, 0, { zoom }), ctx);
      }
      tool.onCommit?.(ctx);
      return drawPoints([...shapes.values()][0]);
    };

    const atZoom1 = walk(1);
    // 0.4-unit steps clear the 1-unit gate on every third sample, and do so
    // whether the camera is zoomed in or far out.
    expect(atZoom1?.length).toBe(14);
    expect(walk(4)).toEqual(atZoom1);
    expect(walk(0.05)).toEqual(atZoom1);
  });

  it('onCancel discards the in-progress stroke', () => {
    const { ctx, shapes } = context();
    const tool = createDrawTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
    tool.onCancel?.(ctx);

    expect(shapes.size).toBe(0);
  });
});
