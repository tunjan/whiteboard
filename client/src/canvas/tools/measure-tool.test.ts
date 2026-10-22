import { beforeEach, describe, expect, it } from 'vitest';
import type { Editor } from '../editor';
import { measureLabel } from '../MeasureLayer';
import { useMeasureStore } from '../use-measure-store';
import { createMeasureTool } from './measure-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// An empty board: nothing to snap to, so ends land where the pointer is.
const ctx: ToolContext = {
  editor: {
    getShape: () => undefined,
    getShapes: () => [],
    createShape: () => undefined,
    updateShape: () => undefined,
    deleteShapes: () => undefined,
    transact: (fn) => fn(),
  } satisfies Editor,
  setTool: () => undefined,
  complete: () => undefined,
};

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

describe('measure tool', () => {
  beforeEach(() => useMeasureStore.getState().clear());

  it('keeps the measured span after release, without touching the document', () => {
    const tool = createMeasureTool();
    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(30, 40), ctx);
    tool.onPointerUp?.(pointer(30, 40), ctx);
    tool.onPointerMove?.(pointer(90, 90), ctx);

    const span = useMeasureStore.getState().span!;
    expect(span).toEqual({ a: { x: 0, y: 0 }, b: { x: 30, y: 40 } });
    expect(measureLabel(span.a, span.b)).toMatch(/^50 · /);
  });

  it('clears on cancel and on leaving the tool', () => {
    const tool = createMeasureTool();
    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onCancel?.(ctx);
    expect(useMeasureStore.getState().span).toBeNull();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerUp?.(pointer(10, 0), ctx);
    tool.onExit?.(ctx);
    expect(useMeasureStore.getState().span).toBeNull();
  });
});

describe('measureLabel', () => {
  it('reads angles counter-clockwise from +x, as on paper', () => {
    // World y points down, so up-right on screen is negative y.
    expect(measureLabel({ x: 0, y: 0 }, { x: 10, y: -10 })).toBe('14 · 45°');
    expect(measureLabel({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe('10 · 180°');
    expect(measureLabel({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe('10 · 270°');
    expect(measureLabel({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe('0 · 0°');
  });
});
