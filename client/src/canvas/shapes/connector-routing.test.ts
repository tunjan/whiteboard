import { describe, expect, it } from 'vitest';
import type {
  ArrowShape,
  FrameShape,
  RectangleShape,
  Shape,
} from '@whiteboard/shared';
import './register';
import { arrowHandleDrag } from './connector-handles';
import {
  bindingForPoint,
  connectorLocalToWorld,
  findBindableShapeAt,
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
    const moved = rectangle({
      x: 300,
      y: 250,
      props: { ...initial.props, w: 300 },
    });
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
      expect(Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6).toBe(
        true,
      );
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

function boundArrow(
  id: string,
  targetId: string,
  points: ArrowShape['props']['points'],
): ArrowShape {
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

  it('finds dirty arrows through the id index without scanning the page', () => {
    const editor = recordingEditor();
    const shapes = scene();
    const index = new Map(shapes.map((shape) => [shape.id, shape]));
    // An empty page proves the arrow came from the index, not a scan.
    syncBoundArrows([], editor, new Set(['box', 'arrow', 'deleted']), index);
    expect(editor.updated).toEqual(['arrow']);
    editor.updated.length = 0;
    syncBoundArrows([], editor, new Set(['unrelated']), index);
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
      {
        ...boundArrow('arrow', 'box', [{ x: -50, y: 0 }, anchored]),
        index: 'a1',
      },
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

/** Editor stub that applies patches, so a sync can be re-run on its output. */
function liveEditor(shapes: Shape[]): Editor & { writes: number } {
  const editor = {
    writes: 0,
    getShape: (id: string) => shapes.find((s) => s.id === id),
    getShapes: () => shapes,
    createShape: () => {},
    deleteShapes: () => {},
    transact: (fn: () => void) => fn(),
    updateShape: (id: string, patch: ShapePatch) => {
      editor.writes++;
      const i = shapes.findIndex((s) => s.id === id);
      const s = shapes[i]!;
      shapes[i] = {
        ...s,
        ...patch,
        props: { ...s.props, ...patch.props },
      } as Shape;
    },
  };
  return editor;
}

function frame(overrides: Partial<FrameShape> = {}): FrameShape {
  return {
    id: 'frame',
    type: 'frame',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: { w: 1000, h: 1000, name: 'F' },
    ...overrides,
  };
}

describe('rotated connectors', () => {
  const worldEnd = (shapes: Shape[], index: number) => {
    const arrow = shapes[1] as ArrowShape;
    return connectorLocalToWorld(arrow, arrow.props.points[index]!);
  };

  for (const [topology, bend] of [
    ['straight', 0],
    ['arc', 40],
  ] as const) {
    it(`lands a bound ${topology} end on its target in one pass at any angle`, () => {
      for (const degrees of [30, 90, 180, 270]) {
        const box = rectangle({ id: 'box', x: 320, y: 0 });
        const arrow = boundArrow('arrow', 'box', [
          { x: 0, y: 50 },
          { x: 300, y: 50 },
        ]);
        arrow.rotation = (degrees * Math.PI) / 180;
        arrow.index = 'a1';
        arrow.props = { ...arrow.props, topology, bend };
        const shapes: Shape[] = [box, arrow];
        const freeEnd = worldEnd(shapes, 0);
        const editor = liveEditor(shapes);
        syncBoundArrows(shapes, editor, null);
        const writes = editor.writes;
        syncBoundArrows(shapes, editor, null);
        expect(editor.writes).toBe(writes);

        const want = pointForBinding(
          (shapes[1] as ArrowShape).props.bindings!.end!,
          box,
        )!;
        const got = worldEnd(shapes, 1);
        expect(got.x).toBeCloseTo(want.x, 4);
        expect(got.y).toBeCloseTo(want.y, 4);
        const start = worldEnd(shapes, 0);
        expect(start.x).toBeCloseTo(freeEnd.x, 4);
        expect(start.y).toBeCloseTo(freeEnd.y, 4);
      }
    });
  }

  it('moves only the dragged end of a rotated arrow', () => {
    const arrow = {
      ...boundArrow('arrow', 'box', [
        { x: 0, y: 50 },
        { x: 300, y: 50 },
      ]),
      rotation: Math.PI / 2,
    };
    arrow.props = { ...arrow.props, bindings: {} };
    const start = connectorLocalToWorld(arrow, arrow.props.points[0]!);
    const result = arrowHandleDrag(arrow, 'end', { x: 500, y: 500 }, {
      shiftKey: false,
    });
    const after = {
      ...arrow,
      x: result.x!,
      y: result.y!,
      props: { ...arrow.props, ...result.props },
    } as ArrowShape;
    const newStart = connectorLocalToWorld(after, after.props.points[0]!);
    const newEnd = connectorLocalToWorld(after, after.props.points[1]!);
    expect(newStart.x).toBeCloseTo(start.x, 4);
    expect(newStart.y).toBeCloseTo(start.y, 4);
    expect(newEnd.x).toBeCloseTo(500, 4);
    expect(newEnd.y).toBeCloseTo(500, 4);
  });

  it('leaves a rotated target outward from the bound side', () => {
    // Anchored on the box's left edge; turned a quarter clockwise, that edge
    // faces up, so the elbow must leave upward.
    const box = rectangle({
      id: 'box',
      x: 300,
      y: 300,
      rotation: Math.PI / 2,
      props: { ...rectangle().props, w: 100, h: 100 },
    });
    const arrow = boundArrow('arrow', 'box', [
      { x: 0, y: 0 },
      { x: 300, y: 300 },
    ]);
    arrow.index = 'a1';
    arrow.props = {
      ...arrow.props,
      topology: 'elbow',
      bindings: { end: { shapeId: 'box', anchor: { x: 0.001, y: 0.5 } } },
    };
    const shapes: Shape[] = [box, arrow];
    syncBoundArrows(shapes, liveEditor(shapes), null);
    const points = (shapes[1] as ArrowShape).props.points;
    const end = points[points.length - 1]!;
    const before = points[points.length - 2]!;
    expect(before.x).toBeCloseTo(end.x, 4);
    expect(before.y).toBeLessThan(end.y);
  });
});

describe('frames as binding targets', () => {
  it('ignores the empty interior of a frame', () => {
    expect(findBindableShapeAt([frame()], { x: 500, y: 500 }, 10)).toBeNull();
  });

  it('binds near the frame border', () => {
    expect(findBindableShapeAt([frame()], { x: 995, y: 500 }, 10)?.id).toBe(
      'frame',
    );
  });

  it('keeps an arrow bound to a frame out of the frame', () => {
    const shapes: Shape[] = [
      frame({ x: 300, props: { w: 100, h: 100, name: 'F' } }),
      {
        ...boundArrow('arrow', 'frame', [
          { x: 0, y: 50 },
          { x: 300, y: 50 },
        ]),
        index: 'a1',
      },
    ];
    syncBoundArrows(shapes, liveEditor(shapes), null);
    expect(shapes[1]!.parentId ?? null).toBeNull();
  });
});
