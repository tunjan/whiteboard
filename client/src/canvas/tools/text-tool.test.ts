import { afterEach, describe, expect, it } from 'vitest';
import type { Shape, TextShape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { DOT_GRID_BASE_STEP } from '../grid';
import { MIN_TEXT_WIDTH, textLineHeight } from '../shapes/text-measure';
import { useCanvasUiStore } from '../use-canvas-ui-store';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { useTextEditingStore } from '../use-text-editing-store';
import { createTextTool } from './text-tool';
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
  const editor = {
    getShape: (id: string) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (shape: Shape) => shapes.set(shape.id, shape),
    updateShape: (id: string, patch: Partial<Shape>) => {
      const prev = shapes.get(id);
      if (!prev) return;
      const props = (patch as { props?: object }).props;
      shapes.set(id, {
        ...prev,
        ...patch,
        props: props ? { ...prev.props, ...props } : prev.props,
      } as Shape);
    },
    deleteShapes: (ids: string[]) => ids.forEach((id) => shapes.delete(id)),
    transact: (fn: () => void) => fn(),
  } as unknown as Editor;
  return {
    ctx: { editor, setTool: () => undefined, complete: () => undefined },
    shapes,
  };
}

function created(shapes: Map<string, Shape>): TextShape | undefined {
  const shape = [...shapes.values()][0];
  return shape?.type === 'text' ? shape : undefined;
}

// Past both gates in section 2: held long enough, and dragged far enough.
const HELD = { timestamp: 200 };

afterEach(() => {
  useStyleStore.getState().setAlign('start');
  useTextEditingStore.getState().stop();
  useSelectionStore.getState().clear();
  useCanvasUiStore.setState({ snappingEnabled: false, background: 'blank' });
});

describe('click to create', () => {
  it('creates an auto-sizing text and opens the editor on it', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();

    tool.onPointerDown!(pointer(50, 50), ctx);
    // Nothing is committed until the gesture says which kind of text it is.
    expect(shapes.size).toBe(0);

    tool.onPointerUp!(pointer(50, 50), ctx);
    const shape = created(shapes)!;
    expect(shape.props.sizingMode).toBe('auto');
    expect(useTextEditingStore.getState().editingId).toBe(shape.id);
  });

  it('centres the first line on the click point', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(50, 50), ctx);
    tool.onPointerUp!(pointer(50, 50), ctx);

    const shape = created(shapes)!;
    const halfLine =
      Math.round(shape.props.fontSize * textLineHeight(shape.props)) / 2;
    expect(shape.y).toBeCloseTo(50 - halfLine);
  });

  it('puts the click point on the left edge whatever the alignment', () => {
    for (const align of ['start', 'middle', 'end'] as const) {
      useStyleStore.getState().setAlign(align);
      const { ctx, shapes } = context();
      const tool = createTextTool();
      tool.onPointerDown!(pointer(50, 50), ctx);
      tool.onPointerUp!(pointer(50, 50), ctx);
      expect(created(shapes)!.props.align).toBe(align);
      expect(created(shapes)!.x).toBeCloseTo(50);
    }
  });
});

describe('drag to create a fixed-width box', () => {
  it('ignores a drag that has not been held long enough', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(50, 50), ctx);
    tool.onPointerMove!(pointer(400, 50, { timestamp: 149 }), ctx);
    expect(shapes.size).toBe(0);
  });

  it('ignores a held press that has not travelled far enough', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(50, 50), ctx);
    tool.onPointerMove!(pointer(60, 50, HELD), ctx);
    expect(shapes.size).toBe(0);
  });

  it('creates a wrapping box once both gates are cleared', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(50, 50), ctx);
    tool.onPointerMove!(pointer(250, 50, HELD), ctx);

    const shape = created(shapes)!;
    expect(shape.props.sizingMode).toBe('fixed');
    expect(shape.x).toBeCloseTo(50);
    expect(shape.props.width).toBeCloseTo(200);

    tool.onPointerUp!(pointer(250, 50), ctx);
    expect(useTextEditingStore.getState().editingId).toBe(shape.id);
  });

  it('holds the distance gate fixed in screen pixels, not world units', () => {
    // The gate is 24 screen px. Zoomed 4x in, that is only 6 world units, so
    // the same hand movement has to open a box at either zoom level.
    const zoomedIn = context();
    const a = createTextTool();
    a.onPointerDown!(pointer(0, 0, { zoom: 4 }), zoomedIn.ctx);
    a.onPointerMove!(pointer(7, 0, { ...HELD, zoom: 4 }), zoomedIn.ctx);
    expect(zoomedIn.shapes.size).toBe(1);

    // The same 7 world units at 1x is well inside the gate: a click, not a drag.
    const zoomedOut = context();
    const b = createTextTool();
    b.onPointerDown!(pointer(0, 0), zoomedOut.ctx);
    b.onPointerMove!(pointer(7, 0, HELD), zoomedOut.ctx);
    expect(zoomedOut.shapes.size).toBe(0);
  });

  it('gives a coarse pointer more room before it commits to a box', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(0, 0), ctx);
    // 30 world units clears the 24px mouse gate but not the 36px touch one.
    tool.onPointerMove!(pointer(30, 0, { ...HELD, pointerType: 'touch' }), ctx);
    expect(shapes.size).toBe(0);
    tool.onPointerMove!(pointer(40, 0, { ...HELD, pointerType: 'touch' }), ctx);
    expect(shapes.size).toBe(1);
  });

  it('grows leftward rather than inverting when dragged back past the origin', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(300, 50), ctx);
    tool.onPointerMove!(pointer(100, 50, HELD), ctx);

    const shape = created(shapes)!;
    expect(shape.x).toBeCloseTo(100);
    expect(shape.props.width).toBeCloseTo(200);
  });

  it('never collapses below the minimum width', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(0, 0), ctx);
    tool.onPointerMove!(pointer(200, 0, HELD), ctx);
    tool.onPointerMove!(pointer(0, 0, HELD), ctx);
    expect(created(shapes)!.props.width).toBe(MIN_TEXT_WIDTH);
  });
});

describe('grid snapping on create', () => {
  it('snaps the corner to the grid when snapping is on', () => {
    useCanvasUiStore.setState({ snappingEnabled: true, background: 'dot' });
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(53, 47), ctx);
    tool.onPointerUp!(pointer(53, 47), ctx);

    const shape = created(shapes)!;
    expect(shape.x % DOT_GRID_BASE_STEP).toBe(0);
    expect(shape.y % DOT_GRID_BASE_STEP).toBe(0);
  });

  it('leaves placement alone on a blank background', () => {
    useCanvasUiStore.setState({ snappingEnabled: true, background: 'blank' });
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(53, 47), ctx);
    tool.onPointerUp!(pointer(53, 47), ctx);
    expect(created(shapes)!.x).toBeCloseTo(53);
  });
});

describe('interrupted gestures', () => {
  it('drops the in-flight box when a pinch cancels the gesture', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(0, 0), ctx);
    tool.onPointerMove!(pointer(200, 0, HELD), ctx);
    tool.onCancel!(ctx);
    expect(shapes.size).toBe(0);
    expect(useTextEditingStore.getState().editingId).toBeNull();
  });

  it('keeps the box when the OS reclaims the pointer mid-drag', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(0, 0), ctx);
    tool.onPointerMove!(pointer(200, 0, HELD), ctx);
    tool.onCommit!(ctx);
    expect(shapes.size).toBe(1);
    expect(useTextEditingStore.getState().editingId).toBe(created(shapes)!.id);
  });

  it('does not resurrect a finished gesture on a later stray move', () => {
    const { ctx, shapes } = context();
    const tool = createTextTool();
    tool.onPointerDown!(pointer(0, 0), ctx);
    tool.onPointerUp!(pointer(0, 0), ctx);
    tool.onPointerMove!(pointer(400, 0, HELD), ctx);
    expect(shapes.size).toBe(1);
    expect(created(shapes)!.props.sizingMode).toBe('auto');
  });
});
