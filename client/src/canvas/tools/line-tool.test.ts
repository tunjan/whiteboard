import { ArrowRight } from 'lucide-react';
import { afterEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { spatialIndex } from '../use-document-store';
import { useSelectionStore } from '../use-selection-store';
import { createLineTool } from './line-tool';
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

/** A rectangle at (100,100)-(200,200), registered as a snap target. */
function target(): Shape {
  return {
    id: 'rect-1',
    type: 'rectangle',
    x: 100,
    y: 100,
    rotation: 0,
    opacity: 1,
    index: 'a1',
    props: { w: 100, h: 100, color: 'black', size: 'm', dash: 'solid', fill: 'none', label: '' },
  } as unknown as Shape;
}

function context(): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map<string, Shape>();
  const editor = {
    getShape: (id: string) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (shape: Shape) => shapes.set(shape.id, shape),
    updateShape: (id: string, patch: { props?: Record<string, unknown> }) => {
      const current = shapes.get(id);
      if (!current) return;
      shapes.set(id, {
        ...current,
        props: { ...current.props, ...patch.props },
      } as Shape);
    },
    deleteShapes: (ids: string[]) => ids.forEach((id) => shapes.delete(id)),
    transact: (fn: () => void) => fn(),
  } as unknown as Editor;
  return { ctx: { editor, setTool: () => undefined, complete: () => undefined }, shapes };
}

function lineTool() {
  return createLineTool({
    id: 'line',
    type: 'line',
    label: 'Line',
    hotkey: 'l',
    icon: ArrowRight,
  });
}

/** The in-flight line, and its endpoint in world coordinates. */
function drawn(shapes: Map<string, Shape>) {
  const shape = [...shapes.values()].find((s) => s.type === 'line');
  if (shape?.type !== 'line') return undefined;
  const last = shape.props.points[shape.props.points.length - 1]!;
  return { shape, end: { x: shape.x + last.x, y: shape.y + last.y } };
}

function withTarget(shapes: Map<string, Shape>): void {
  const rect = target();
  shapes.set(rect.id, rect);
  spatialIndex.insert(rect.id, { minX: 100, minY: 100, maxX: 200, maxY: 200 });
}

afterEach(() => {
  spatialIndex.clear();
  useSelectionStore.getState().setSnapGuides([]);
});

describe('line tool snapping while creating', () => {
  it('snaps the start point to nearby geometry before placing the shape', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = lineTool();

    // Off the corner diagonally, so the corner is the nearest geometry.
    tool.onPointerDown?.(pointer(97, 96), ctx);

    const line = drawn(shapes);
    expect({ x: line?.shape.x, y: line?.shape.y }).toEqual({ x: 100, y: 100 });
  });

  it('snaps the endpoint onto the nearest outline edge during the drag', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = lineTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(198, 205), ctx);

    // Projected onto the rectangle's bottom edge, which is nearer than its corner.
    expect(drawn(shapes)?.end).toEqual({ x: 198, y: 200 });
    expect(useSelectionStore.getState().snapGuides.length).toBeGreaterThan(0);
  });

  it('leaves the endpoint alone while alt bypasses snapping', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = lineTool();

    tool.onPointerDown?.(pointer(0, 0, { altKey: true }), ctx);
    tool.onPointerMove?.(pointer(198, 205, { altKey: true }), ctx);

    expect(drawn(shapes)?.end).toEqual({ x: 198, y: 205 });
    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });

  it('lets the shift axis lock win over snapping', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = lineTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(198, 205, { shiftKey: true }), ctx);

    // The drag is steeper than it is wide, so it locks vertical and stays there.
    expect(drawn(shapes)?.end).toEqual({ x: 0, y: 205 });
    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });

  it('snaps an arrow endpoint too, and still binds it to the target', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = createLineTool({
      id: 'arrow',
      type: 'arrow',
      label: 'Arrow',
      hotkey: 'a',
      icon: ArrowRight,
    });

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(198, 205), ctx);

    const arrow = [...shapes.values()].find((s) => s.type === 'arrow');
    expect(arrow?.type).toBe('arrow');
    if (arrow?.type !== 'arrow') return;
    // Landing on the outline puts it inside binding range of the rectangle.
    expect(arrow.props.bindings?.end?.shapeId).toBe('rect-1');
  });

  it('clears guides once the gesture finishes', () => {
    const { ctx, shapes } = context();
    withTarget(shapes);
    const tool = lineTool();

    tool.onPointerDown?.(pointer(0, 0), ctx);
    tool.onPointerMove?.(pointer(198, 205), ctx);
    tool.onPointerUp?.(pointer(198, 205), ctx);

    expect(useSelectionStore.getState().snapGuides).toEqual([]);
  });
});
