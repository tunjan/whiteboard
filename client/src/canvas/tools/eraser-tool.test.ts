import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { shapeRotatedBounds } from '../shape-bounds';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useEraserStore } from '../use-eraser-store';
import { createEraserTool } from './eraser-tool';
import type { ToolContext, ToolPointerInfo } from './types';

function rectangle(): Extract<Shape, { type: 'rectangle' }> {
  return {
    id: 'target',
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
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

function context(shape: Shape): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map([[shape.id, shape]]);
  spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (next) => shapes.set(next.id, next),
    updateShape: () => undefined,
    deleteShapes: (ids) => {
      for (const id of ids) {
        shapes.delete(id);
        spatialIndex.remove(id);
      }
    },
    transact: (fn) => fn(),
  };
  return { ctx: { editor, setTool: () => undefined, complete: () => undefined }, shapes };
}

describe('eraser tool stroke lifecycle', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  });

  afterEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
  });

  it('commits queued targets when a pen or mouse gesture loses capture', () => {
    const { ctx, shapes } = context(rectangle());
    const tool = createEraserTool();

    tool.onPointerDown?.(pointer(20, 15), ctx);
    expect(useEraserStore.getState().isMarked('target')).toBe(true);

    tool.onCommit?.(ctx);

    expect(shapes.has('target')).toBe(false);
    expect(useEraserStore.getState().marked).toEqual({});
  });
});
