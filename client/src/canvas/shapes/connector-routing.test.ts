import { describe, expect, it } from 'vitest';
import type { ArrowShape, RectangleShape, Shape } from '@whiteboard/shared';
import './register';
import {
  bindingForPoint,
  orthogonalRoute,
  pointForBinding,
  syncBoundArrows,
} from './connector-routing';
import type { Editor, ShapePatch } from '../editor';

function rectangle(overrides: Partial<RectangleShape> = {}): RectangleShape {
  return {
    id: 'target',
    type: 'rectangle',
    x: 100,
    y: 100,
    rotation: 0,
    index: 'a0',
    props: {
      w: 200,
      h: 100,
      color: '#000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
    ...overrides,
  };
}

describe('connector binding and elbow routing', () => {
  it('projects an interior terminal to the target perimeter', () => {
    const target = rectangle();
    const result = bindingForPoint(
      target,
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    );
    expect(result).not.toBeNull();
    expect(result!.point.x).toBeCloseTo(100, 5);
    expect(result!.point.y).toBeCloseTo(150, 5);
    expect(result!.binding.anchor.x).toBeCloseTo(0.001, 5);
  });

  it('keeps a normalized binding attached after move and resize', () => {
    const initial = rectangle();
    const result = bindingForPoint(
      initial,
      { x: 200, y: 150 },
      { x: 0, y: 150 },
    )!;
    const moved = rectangle({ x: 300, y: 250, props: { ...initial.props, w: 300 } });
    const point = pointForBinding(result.binding, moved)!;
    expect(point.x).toBeCloseTo(300.3, 4);
    expect(point.y).toBeCloseTo(300, 4);
  });

  it('produces only axis-aligned segments and routes around inflated targets', () => {
    const route = orthogonalRoute(
      { x: 100, y: 40 },
      { x: 280, y: 180 },
      {
        startBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        endBounds: { minX: 280, minY: 120, maxX: 380, maxY: 220 },
        startDirection: { x: 1, y: 0 },
        endDirection: { x: -1, y: 0 },
      },
    );
    expect(route.length).toBeGreaterThanOrEqual(3);
    for (let index = 0; index < route.length - 1; index++) {
      const a = route[index]!;
      const b = route[index + 1]!;
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(true);
    }
  });

  it('honors outward terminal directions even when endpoints are aligned', () => {
    const route = orthogonalRoute(
      { x: 0, y: 50 },
      { x: 300, y: 50 },
      {
        startBounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
        endBounds: { minX: 200, minY: 0, maxX: 300, maxY: 100 },
        startDirection: { x: -1, y: 0 },
        endDirection: { x: 1, y: 0 },
      },
    );
    expect(route[1]!.x).toBeLessThan(0);
    expect(route[route.length - 2]!.x).toBeGreaterThan(300);
  });
});

/** Editor stub that records the shapes `syncBoundArrows` chose to rewrite. */
function recordingEditor(): Editor & { updated: string[] } {
  const updated: string[] = [];
  return {
    updated,
    getShape: () => undefined,
    getShapes: () => [],
    createShape: () => {},
    deleteShapes: () => {},
    transact: (fn: () => void) => fn(),
    updateShape: (id: string, _patch: ShapePatch) => {
      updated.push(id);
    },
  };
}

function boundArrow(id: string, targetId: string, points: ArrowShape['props']['points']): ArrowShape {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      points,
      color: '#000',
      size: 2,
      dash: 'solid',
      arrowStart: false,
      arrowEnd: true,
      bend: 0,
      topology: 'straight',
      bindings: { end: { shapeId: targetId, anchor: { x: 0.5, y: 0.5 } } },
      label: '',
    },
  };
}

describe('syncBoundArrows dirty-set narrowing', () => {
  /** A box at the origin and an arrow whose end is bound to it but stale. */
  function scene(): Shape[] {
    return [
      rectangle({ id: 'box', x: 0, y: 0 }),
      boundArrow('arrow', 'box', [
        { x: -50, y: 0 },
        { x: -10, y: 0 },
      ]),
    ];
  }

  it('re-resolves a stale bound arrow when rescanning everything', () => {
    const editor = recordingEditor();
    syncBoundArrows(scene(), editor, null);
    expect(editor.updated).toEqual(['arrow']);
  });

  it('re-resolves an arrow bound to a shape in the dirty set', () => {
    const editor = recordingEditor();
    // The expanded dirty set contains the moved box and its bound arrow.
    syncBoundArrows(scene(), editor, new Set(['box', 'arrow']));
    expect(editor.updated).toEqual(['arrow']);
  });

  it('skips arrows outside the dirty set', () => {
    const editor = recordingEditor();
    // Something unrelated moved: the arrow is stale but must not be touched.
    syncBoundArrows(scene(), editor, new Set(['unrelated']));
    expect(editor.updated).toEqual([]);
  });

  it('does no work at all for an empty dirty set', () => {
    const editor = recordingEditor();
    syncBoundArrows(scene(), editor, new Set());
    expect(editor.updated).toEqual([]);
  });

  it('leaves an already-correct arrow alone', () => {
    const editor = recordingEditor();
    const box = rectangle({ id: 'box', x: 0, y: 0 });
    // Where the binding actually resolves to, rather than a guessed point.
    const anchored = pointForBinding(
      { shapeId: 'box', anchor: { x: 0.5, y: 0.5 } },
      box,
    )!;
    const settled: Shape[] = [
      box,
      boundArrow('arrow', 'box', [{ x: -50, y: 0 }, anchored]),
    ];
    syncBoundArrows(settled, editor, null);
    expect(editor.updated).toEqual([]);
  });

  it('clears a binding whose target has been deleted', () => {
    const editor = recordingEditor();
    const orphaned: Shape[] = [
      boundArrow('arrow', 'gone', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    ];
    syncBoundArrows(orphaned, editor, null);
    expect(editor.updated).toEqual(['arrow']);
  });

  it('ignores unbound arrows entirely', () => {
    const editor = recordingEditor();
    const unbound: ArrowShape = {
      ...boundArrow('arrow', 'box', [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ]),
    };
    unbound.props = { ...unbound.props, bindings: {} };
    syncBoundArrows([rectangle({ id: 'box' }), unbound], editor, null);
    expect(editor.updated).toEqual([]);
  });
});
