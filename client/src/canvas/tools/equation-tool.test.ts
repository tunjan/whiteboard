import { beforeEach, describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { consumeEquationFocus } from '../equation-focus';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import { createEquationTool } from './equation-tool';
import type { ToolContext, ToolPointerInfo } from './types';

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

function context(): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map<string, Shape>();
  const editor: Editor = {
    getShape: (id) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (next) => shapes.set(next.id, next),
    updateShape: () => undefined,
    deleteShapes: (ids) => {
      for (const id of ids) shapes.delete(id);
    },
    transact: (fn) => fn(),
  };
  return {
    ctx: { editor, setTool: () => undefined, complete: () => undefined },
    shapes,
  };
}

function placedEquation(shapes: Map<string, Shape>) {
  const shape = [...shapes.values()][0];
  if (shape?.type !== 'equation') throw new Error('no equation was placed');
  return shape;
}

describe('equation tool placement', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
    useStyleStore.setState({ color: '#d6568c' });
  });

  it('takes the current drawing color, like every other tool', () => {
    const { ctx, shapes } = context();

    createEquationTool().onPointerDown?.(pointer(100, 50), ctx);

    expect(placedEquation(shapes).props.color).toBe('#d6568c');
  });

  it('centers the new equation on the click point', () => {
    const { ctx, shapes } = context();

    createEquationTool().onPointerDown?.(pointer(100, 50), ctx);

    const shape = placedEquation(shapes);
    expect(shape.x + shape.props.w / 2).toBe(100);
    expect(shape.y + shape.props.h / 2).toBe(50);
  });

  it('requests focus for the shape it just placed', () => {
    const { ctx, shapes } = context();

    createEquationTool().onPointerDown?.(pointer(0, 0), ctx);

    const shape = placedEquation(shapes);
    expect(useSelectionStore.getState().selectedIds).toEqual([shape.id]);
    expect(consumeEquationFocus(shape.id)).toBe(true);
  });

  it('ignores non-primary buttons', () => {
    const { ctx, shapes } = context();

    createEquationTool().onPointerDown?.({ ...pointer(0, 0), button: 2 }, ctx);

    expect(shapes.size).toBe(0);
  });
});
