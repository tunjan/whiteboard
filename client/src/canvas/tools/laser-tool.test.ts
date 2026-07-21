import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Editor } from '../editor';
import { LASER_FADE_MS, useLaserStore } from '../use-laser-store';
import { createLaserTool } from './laser-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// The laser never touches the document, so the editor can be inert.
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

describe('laser tool stroke lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLaserStore.setState({ strokes: [] });
  });

  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    useLaserStore.setState({ strokes: [] });
  });

  it('builds an ephemeral stroke that fades away after pointer up', () => {
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(10, 0), ctx);
    tool.onPointerMove?.(pointer(20, 5), ctx);

    const [stroke] = useLaserStore.getState().strokes;
    expect(stroke?.points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 5 },
    ]);
    expect(stroke?.done).toBe(false);

    tool.onPointerUp?.(pointer(20, 5), ctx);
    expect(useLaserStore.getState().strokes[0]?.done).toBe(true);

    // The stroke never touches the document; it evaporates after the fade.
    vi.advanceTimersByTime(LASER_FADE_MS);
    expect(useLaserStore.getState().strokes).toEqual([]);
  });

  it('skips move samples closer than one screen pixel', () => {
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(0.4, 0.4), ctx);

    expect(useLaserStore.getState().strokes[0]?.points).toHaveLength(1);
  });

  it('discards the partial stroke when the gesture is cancelled', () => {
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(30, 30), ctx);
    tool.onCancel?.(ctx);

    expect(useLaserStore.getState().strokes).toEqual([]);
  });

  it('keeps the stroke and fades it when capture is lost mid-stroke', () => {
    const tool = createLaserTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onCommit?.(ctx);

    expect(useLaserStore.getState().strokes[0]?.done).toBe(true);
    vi.advanceTimersByTime(LASER_FADE_MS);
    expect(useLaserStore.getState().strokes).toEqual([]);
  });
});
