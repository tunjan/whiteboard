import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawPoint, DrawShape } from '@whiteboard/shared';
import '../shapes/register';
import {
  breakUndoCapture,
  editor,
  loadBoard,
  undo,
} from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useEraserCutStore } from '../use-eraser-cut-store';
import { useEraserStore } from '../use-eraser-store';
import { useEraserTrailStore } from '../use-eraser-trail-store';
import { createEraserTool } from './eraser-tool';
import type { ToolContext, ToolPointerInfo } from './types';

// The eraser driven against the real Yjs-backed editor rather than a fake, so
// the point-array replace path and the undo grouping are exercised end to end.

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, String(value)),
  } as Storage;
}

function stroke(n: number): DrawPoint[] {
  const points: DrawPoint[] = [];
  for (let i = 0; i < n; i++) points.push({ x: i, y: 0, pressure: 0.5 });
  return points;
}

function ink(id: string, points: DrawPoint[]): DrawShape {
  return {
    id,
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      points,
      isClosed: false,
      color: '#000000',
      size: 4,
      dash: 'solid',
      fillStyle: 'none',
    },
  };
}

function pointer(x: number, y: number): ToolPointerInfo {
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
  };
}

const ctx: ToolContext = {
  editor,
  setTool: () => undefined,
  complete: () => undefined,
};

function drawShapes(): DrawShape[] {
  return editor.getShapes().filter((s): s is DrawShape => s.type === 'draw');
}

let dispose: () => void;
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryStorage());
  vi.stubGlobal('sessionStorage', memoryStorage());
  dispose = loadBoard('test-precision-eraser', {
    persist: false,
    collab: false,
  });
  useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  useCanvasUiStore.getState().setEraserMode('precision');
  useEraserTrailStore.getState().clear();
});
afterEach(() => {
  dispose();
  useEraserStore.getState().clear();
  useEraserCutStore.getState().clear();
  useEraserTrailStore.getState().clear();
  useCanvasUiStore.getState().setEraserMode('object');
});

describe('precision eraser against the document', () => {
  it('cuts a stroke into two shapes that one undo restores', () => {
    editor.createShape(ink('s', stroke(200)));
    const tool = createEraserTool();

    // The canvas breaks undo capture at both gesture boundaries.
    breakUndoCapture();
    tool.onPointerDown?.(pointer(100, -20), ctx);
    tool.onPointerMove?.(pointer(100, 20), ctx);
    tool.onPointerUp?.(pointer(100, 20), ctx);
    breakUndoCapture();

    const after = drawShapes();
    expect(after).toHaveLength(2);
    // The stroke's own points survive the cut unchanged — only the ones the
    // eraser passed over are gone, plus a boundary point at each cut edge.
    const left = after[0]!.id === 's' ? after[0]! : after[1]!;
    const right = after[0]!.id === 's' ? after[1]! : after[0]!;
    expect(left.props.points[0]).toEqual({ x: 0, y: 0, pressure: 0.5 });
    expect(left.props.points[left.props.points.length - 1]!.x).toBeLessThan(
      100,
    );
    expect(right.props.points[0]!.x).toBeGreaterThan(100);
    expect(right.props.points[right.props.points.length - 1]).toEqual({
      x: 199,
      y: 0,
      pressure: 0.5,
    });
    // The two halves are stacked adjacently, in drawing order.
    expect(left.index < right.index).toBe(true);

    undo();

    const restored = drawShapes();
    expect(restored).toHaveLength(1);
    expect(restored[0]!.id).toBe('s');
    expect(restored[0]!.props.points).toEqual(stroke(200));
  });

  it('erases a stroke entirely when the swipe runs the length of it', () => {
    editor.createShape(ink('s', stroke(200)));
    const tool = createEraserTool();

    breakUndoCapture();
    tool.onPointerDown?.(pointer(-20, 0), ctx);
    tool.onPointerMove?.(pointer(220, 0), ctx);
    tool.onPointerUp?.(pointer(220, 0), ctx);
    breakUndoCapture();

    expect(drawShapes()).toHaveLength(0);

    undo();
    expect(drawShapes()).toHaveLength(1);
  });

  it('takes three bites out of one stroke as a single undo step', () => {
    editor.createShape(ink('s', stroke(200)));
    const tool = createEraserTool();

    breakUndoCapture();
    tool.onPointerDown?.(pointer(50, 0), ctx);
    tool.onPointerMove?.(pointer(100, 0), ctx);
    tool.onPointerMove?.(pointer(100, 40), ctx);
    tool.onPointerMove?.(pointer(150, 40), ctx);
    tool.onPointerMove?.(pointer(150, 0), ctx);
    tool.onPointerMove?.(pointer(160, 0), ctx);
    tool.onPointerUp?.(pointer(160, 0), ctx);
    breakUndoCapture();

    // Two separate rubs along the line leave three pieces.
    expect(drawShapes()).toHaveLength(3);

    undo();
    expect(drawShapes()).toHaveLength(1);
    expect(drawShapes()[0]!.props.points).toEqual(stroke(200));
  });
});
