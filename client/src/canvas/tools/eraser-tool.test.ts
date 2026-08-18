import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor, ShapePatch } from '../editor';
import { shapeRotatedBounds } from '../shape-bounds';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useEraserCutStore } from '../use-eraser-cut-store';
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

/** A horizontal pen stroke from (0,0) to (200,0), sampled every world unit. */
function stroke(): Extract<Shape, { type: 'draw' }> {
  const points = [];
  for (let x = 0; x <= 200; x++) points.push({ x, y: 0, pressure: 0.5 });
  return {
    id: 'ink',
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      points,
      isClosed: false,
      color: '#111',
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

interface Harness {
  ctx: ToolContext;
  shapes: Map<string, Shape>;
  created: Shape[];
  updated: [string, ShapePatch][];
  transacts: number;
}

function context(...initial: Shape[]): Harness {
  const shapes = new Map(initial.map((shape) => [shape.id, shape]));
  for (const shape of initial) spatialIndex.insert(shape.id, shapeRotatedBounds(shape));
  const created: Shape[] = [];
  const updated: [string, ShapePatch][] = [];
  const harness = { shapes, created, updated, transacts: 0 } as Harness;
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (next) => {
      created.push(next);
      shapes.set(next.id, next);
    },
    updateShape: (id, patch) => {
      updated.push([id, patch]);
    },
    deleteShapes: (ids) => {
      for (const id of ids) {
        shapes.delete(id);
        spatialIndex.remove(id);
      }
    },
    transact: (fn) => {
      harness.transacts++;
      fn();
    },
  };
  harness.ctx = { editor, setTool: () => undefined, complete: () => undefined };
  return harness;
}

describe('eraser tool stroke lifecycle', () => {
  beforeEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  });

  afterEach(() => {
    spatialIndex.clear();
    useEraserStore.getState().clear();
    useEraserCutStore.getState().clear();
    useCanvasUiStore.getState().setEraserMode('object');
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

  describe('precision mode', () => {
    beforeEach(() => {
      useCanvasUiStore.getState().setEraserMode('precision');
    });

    it('cuts a stroke in two and writes both halves in one transaction', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, -20), harness.ctx);
      tool.onPointerMove?.(pointer(100, 20), harness.ctx);

      // The document is untouched until release; the preview carries the cut.
      expect(harness.updated).toHaveLength(0);
      expect(useEraserCutStore.getState().fragments.ink).toHaveLength(2);

      tool.onPointerUp?.(pointer(100, 20), harness.ctx);

      expect(harness.transacts).toBe(1);
      // The near half keeps the original id; the far half becomes a new shape.
      expect(harness.updated.map(([id]) => id)).toEqual(['ink']);
      expect(harness.created).toHaveLength(1);
      expect(harness.created[0]!.id).not.toBe('ink');
      expect(harness.shapes.has('ink')).toBe(true);

      const kept = harness.updated[0]![1].props?.points as { x: number }[];
      const split = (harness.created[0]! as Extract<Shape, { type: 'draw' }>).props.points;
      expect(kept[kept.length - 1]!.x).toBeLessThan(100);
      expect(split[0]!.x).toBeGreaterThan(100);
      expect(useEraserCutStore.getState().fragments).toEqual({});
    });

    it('deletes a stroke outright once the swipe covers all of it', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(-20, 0), harness.ctx);
      tool.onPointerMove?.(pointer(220, 0), harness.ctx);
      tool.onPointerUp?.(pointer(220, 0), harness.ctx);

      expect(harness.created).toHaveLength(0);
      expect(harness.shapes.has('ink')).toBe(false);
    });

    it('still removes an uncuttable shape whole', () => {
      const harness = context(rectangle());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(20, 15), harness.ctx);
      expect(useEraserStore.getState().isMarked('target')).toBe(true);

      tool.onPointerUp?.(pointer(20, 15), harness.ctx);

      expect(harness.shapes.has('target')).toBe(false);
      expect(harness.created).toHaveLength(0);
    });

    it('writes nothing when the stroke is cancelled mid-cut', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, -20), harness.ctx);
      tool.onPointerMove?.(pointer(100, 20), harness.ctx);
      tool.onCancel?.(harness.ctx);

      expect(harness.transacts).toBe(0);
      expect(harness.updated).toHaveLength(0);
      expect(harness.shapes.has('ink')).toBe(true);
      expect(useEraserCutStore.getState().fragments).toEqual({});
    });

    it('leaves a stroke alone when the swipe misses it', () => {
      const harness = context(stroke());
      const tool = createEraserTool();

      tool.onPointerDown?.(pointer(100, 60), harness.ctx);
      tool.onPointerMove?.(pointer(140, 60), harness.ctx);
      tool.onPointerUp?.(pointer(140, 60), harness.ctx);

      expect(harness.transacts).toBe(0);
      expect(harness.shapes.has('ink')).toBe(true);
    });
  });

  it('cycles the mode when the eraser hotkey is pressed while active', () => {
    const { ctx } = context();
    const tool = createEraserTool();
    const press = (key: string) =>
      tool.onKeyDown?.({ key } as unknown as KeyboardEvent, ctx);

    expect(press('e')).toBe(true);
    expect(useCanvasUiStore.getState().eraserMode).toBe('precision');

    press('e');
    expect(useCanvasUiStore.getState().eraserMode).toBe('object');

    // Anything else falls through to the canvas shortcuts.
    expect(press('v')).toBe(false);
  });
});
