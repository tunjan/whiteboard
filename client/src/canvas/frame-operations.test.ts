import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import type { Editor, ShapePatch } from './editor';
import {
  captureEnclosedShapes,
  fitFrameToContent,
  kickoutOccludedFrameChildren,
  topFrameAtPoint,
} from './frame-operations';

function rectangle(
  id: string,
  x: number,
  y: number,
  parentId: string | null = null,
): Extract<Shape, { type: 'rectangle' }> {
  return {
    id,
    type: 'rectangle',
    parentId,
    x,
    y,
    rotation: 0,
    index: id,
    props: {
      w: 20,
      h: 10,
      color: '#111',
      fillStyle: 'solid',
      dash: 'solid',
      size: 2,
    },
  };
}

function frame(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  parentId: string | null = null,
): Extract<Shape, { type: 'frame' }> {
  return {
    id,
    type: 'frame',
    parentId,
    x,
    y,
    rotation: 0,
    index: id,
    props: { w, h, name: id, color: '#64748b' },
  };
}

function makeEditor(initial: Shape[]): Editor {
  const shapes = new Map(initial.map((shape) => [shape.id, shape]));
  const update = (shape: Shape, patch: ShapePatch): Shape =>
    ({
      ...shape,
      ...patch,
      props: patch.props ? { ...shape.props, ...patch.props } : shape.props,
    }) as Shape;
  return {
    getShape: (id) => shapes.get(id),
    getShapes: () =>
      [...shapes.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      ),
    createShape: (shape) => void shapes.set(shape.id, shape),
    updateShape: (id, patch) => {
      const shape = shapes.get(id);
      if (shape) shapes.set(id, update(shape, patch));
    },
    deleteShapes: (ids) => ids.forEach((id) => shapes.delete(id)),
    transact: (fn) => fn(),
  };
}

describe('frame capture and nesting', () => {
  it('captures enclosed sibling roots, including an existing frame', () => {
    const outer = frame('outer', 0, 0, 200, 160);
    const nested = frame('nested', 20, 20, 40, 40);
    const inside = rectangle('inside', 100, 80);
    const outside = rectangle('outside', 240, 80);
    const locked = { ...rectangle('locked', 130, 80), locked: true };
    const editor = makeEditor([outer, nested, inside, outside, locked]);

    expect(captureEnclosedShapes(editor, outer.id).sort()).toEqual(
      [nested.id, inside.id].sort(),
    );
    expect(editor.getShape(nested.id)?.parentId).toBe(outer.id);
    expect(editor.getShape(inside.id)?.parentId).toBe(outer.id);
    expect(editor.getShape(outside.id)?.parentId).toBeNull();
    expect(editor.getShape(locked.id)?.parentId).toBeNull();
  });

  it('chooses the highest eligible nested frame under a point', () => {
    const low = frame('a-low', 0, 0, 200, 200);
    const high = frame('z-high', 30, 30, 100, 100, low.id);
    expect(topFrameAtPoint([low, high], { x: 50, y: 50 })?.id).toBe(high.id);
    expect(
      topFrameAtPoint([low, high], { x: 50, y: 50 }, new Set([high.id]))?.id,
    ).toBe(low.id);
  });
});

describe('frame resizing operations', () => {
  it('fits an upright frame to direct content with padding', () => {
    const parent = frame('frame', 0, 0, 200, 160);
    const child = rectangle('child', 50, 40, parent.id);
    const editor = makeEditor([parent, child]);

    expect(fitFrameToContent(editor, parent.id, 10)).toBe(true);
    const fitted = editor.getShape(parent.id);
    expect(fitted?.x).toBeCloseTo(39);
    expect(fitted?.y).toBeCloseTo(29);
    if (fitted?.type === 'frame') {
      // Stroke-aware bounds include one world unit around the child.
      expect(fitted.props.w).toBeCloseTo(42);
      expect(fitted.props.h).toBeCloseTo(32);
    }
  });

  it('promotes fully occluded children but keeps escaping arrows parented', () => {
    const parent = frame('frame', 0, 0, 100, 100);
    const lost = rectangle('lost', 180, 180, parent.id);
    const arrow = {
      id: 'arrow',
      type: 'arrow' as const,
      parentId: parent.id,
      x: 180,
      y: 180,
      rotation: 0,
      index: 'arrow',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 20, y: 20 },
        ],
        color: '#111',
        size: 2,
        dash: 'solid' as const,
        arrowStart: false,
        arrowEnd: true,
        bend: 0,
      },
    };
    const editor = makeEditor([parent, lost, arrow]);

    expect(kickoutOccludedFrameChildren(editor, parent.id)).toEqual([lost.id]);
    expect(editor.getShape(lost.id)?.parentId).toBeNull();
    expect(editor.getShape(arrow.id)?.parentId).toBe(parent.id);
  });
});
