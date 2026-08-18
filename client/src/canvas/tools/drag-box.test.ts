import { beforeEach, describe, expect, it } from 'vitest';
import type { Bounds, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { spatialIndex } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { createBoxTool } from './box-tool';
import { boxFromDrag, snappedBoxFromDrag } from './drag-box';
import type { ToolContext, ToolPointerInfo } from './types';
import { Square } from 'lucide-react';

const TARGET: Bounds = { minX: 100, minY: 0, maxX: 140, maxY: 40 };

function pointer(
  x: number,
  y: number,
  keys: Partial<Pick<ToolPointerInfo, 'shiftKey' | 'altKey'>> = {},
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
    ctrlKey: false,
    metaKey: false,
    button: 0,
  };
}

/** Editor holding one static rectangle for the new shape to snap against. */
function makeContext(): ToolContext {
  const map = new Map<string, Shape>();
  spatialIndex.clear();
  map.set('static', {
    id: 'static',
    type: 'rectangle',
    x: 100,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: null,
    props: { w: 40, h: 40 },
  } as unknown as Shape);
  spatialIndex.insert('static', TARGET);
  return {
    editor: {
      getShape: (id) => map.get(id),
      getShapes: () => [...map.values()],
      createShape: (shape) => void map.set(shape.id, shape),
      updateShape: (id, patch) => {
        const shape = map.get(id);
        if (shape) map.set(id, { ...shape, ...patch } as Shape);
      },
      deleteShapes: (ids) => ids.forEach((id) => map.delete(id)),
      transact: (fn) => fn(),
    } satisfies Editor,
    getViewportBounds: () => ({ minX: -500, minY: -500, maxX: 500, maxY: 500 }),
    setTool: () => {},
    complete: () => {},
  };
}

describe('drag-to-create snapping', () => {
  beforeEach(() => {
    // 'blank' has no grid, so only shape snapping is in play.
    useCanvasUiStore.setState({ snappingEnabled: true, background: 'blank' });
    useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
    useSelectionStore.getState().setSnapGuides([]);
  });

  it('snaps the dragged corner and leaves the pressed corner anchored', () => {
    const box = snappedBoxFromDrag({ x: 0, y: 0 }, pointer(97, 60), [TARGET]);

    expect(box).toEqual({ x: 0, y: 0, w: 100, h: 60 });
    expect(useSelectionStore.getState().snapGuides).toMatchObject([
      { axis: 'x', at: 100 },
    ]);
  });

  it('snaps a corner dragged up and to the left', () => {
    const box = snappedBoxFromDrag({ x: 200, y: 200 }, pointer(103, 150), [
      TARGET,
    ]);

    expect(box).toEqual({ x: 100, y: 150, w: 100, h: 50 });
  });

  it('keeps a shift-drag square when one edge snaps', () => {
    const box = snappedBoxFromDrag(
      { x: 0, y: 0 },
      pointer(97, 90, { shiftKey: true }),
      [TARGET],
    );

    expect(box).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });

  it('bypasses snapping while Alt is held', () => {
    const info = pointer(97, 60, { altKey: true });
    const box = snappedBoxFromDrag({ x: 0, y: 0 }, info, [TARGET]);

    expect(box).toEqual(boxFromDrag({ x: 0, y: 0 }, info.point, false));
    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });

  it('snaps a rectangle as it is dragged out, and clears guides on finish', () => {
    const ctx = makeContext();
    const tool = createBoxTool({
      id: 'rectangle',
      type: 'rectangle',
      label: 'Rectangle',
      hotkey: 'r',
      icon: Square,
    });

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(97, 60), ctx);
    const created = ctx.editor
      .getShapes()
      .find((shape) => shape.id !== 'static');

    expect(created).toMatchObject({ x: 0, y: 0, props: { w: 100, h: 60 } });
    expect(useSelectionStore.getState().snapGuides).toHaveLength(1);

    tool.onPointerUp?.(pointer(97, 60), ctx);
    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });
});
