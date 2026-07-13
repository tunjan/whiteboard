import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import type { Editor } from '../editor';
import { useLaserStore } from '../use-laser-store';
import { createLaserTool, LASER_FADE_MS } from './laser-tool';
import type { ToolContext, ToolPointerInfo } from './types';

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
    pointerType: 'mouse',
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
    updateShape: () => undefined,
    deleteShapes: (ids) => ids.forEach((id) => shapes.delete(id)),
    transact: (fn) => fn(),
  };
  return { ctx: { editor, setTool: () => undefined, complete: () => undefined }, shapes };
}

describe('laser tool', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    useLaserStore.getState().setLaser(null);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('publishes a fading trail without creating board shapes', () => {
    const { ctx, shapes } = context();
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(12, 8), ctx);

    expect(useLaserStore.getState().laser).toMatchObject({
      active: true,
      points: [{ x: 0, y: 0 }, { x: 12, y: 8 }],
    });
    expect(shapes.size).toBe(0);

    tool.onPointerUp?.(pointer(20, 8), ctx);
    expect(useLaserStore.getState().laser).toMatchObject({ active: false });

    vi.advanceTimersByTime(LASER_FADE_MS);
    expect(useLaserStore.getState().laser).toBeNull();
  });

  it('ignores non-primary clicks', () => {
    const { ctx } = context();
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0, { button: 2 }), ctx);

    expect(useLaserStore.getState().laser).toBeNull();
  });
});
