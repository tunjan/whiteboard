import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import type { Editor, ShapePatch } from './editor';
import { flipShapes } from './flip';
import { shapeRegistry } from './shapes/shape-registry';

/** In-memory editor with the `props` shallow-merge `ShapePatch` specifies. */
function makeEditor(shapes: Shape[]): Editor {
  const map = new Map(shapes.map((s) => [s.id, s]));
  return {
    getShape: (id) => map.get(id),
    getShapes: () =>
      [...map.values()].sort((a, b) =>
        a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
      ),
    createShape: (s) => void map.set(s.id, s),
    updateShape: (id, patch: ShapePatch) => {
      const s = map.get(id);
      if (!s) return;
      map.set(id, {
        ...s,
        ...patch,
        props: patch.props ? { ...s.props, ...patch.props } : s.props,
      } as Shape);
    },
    deleteShapes: (ids) => ids.forEach((id) => map.delete(id)),
    transact: (fn) => fn(),
  };
}

let nextIndex = 0;
function base(id: string) {
  return {
    id,
    x: 0,
    y: 0,
    rotation: 0,
    index: `a${nextIndex++}`,
    parentId: null,
  };
}

function rect(id: string, x: number, y: number, w = 40, h = 20, extra = {}) {
  return {
    ...base(id),
    type: 'rectangle' as const,
    x,
    y,
    ...extra,
    props: { w, h, color: '#111', fillStyle: 'none', dash: 'solid', size: 2 },
  } as unknown as Shape;
}

const boundsOf = (editor: Editor, id: string) => {
  const shape = editor.getShape(id)!;
  return shapeRegistry.getFor(shape)!.getBounds(shape as never);
};

describe('flipShapes', () => {
  it('swaps two shapes across the selection centre and keeps the box', () => {
    const editor = makeEditor([rect('a', 0, 0), rect('b', 100, 0)]);
    flipShapes(editor, ['a', 'b'], 'horizontal');
    // The pair spans 0..140 (stroke padding is symmetric), so a mirror puts
    // each shape where the other's far edge was.
    expect(boundsOf(editor, 'a').minX).toBeCloseTo(100);
    expect(boundsOf(editor, 'b').minX).toBeCloseTo(0);
    expect(editor.getShape('a')!.y).toBe(0);
  });

  it('leaves a lone unrotated box exactly where it was', () => {
    const editor = makeEditor([rect('a', 25, 60)]);
    flipShapes(editor, ['a'], 'horizontal');
    expect(editor.getShape('a')!.x).toBeCloseTo(25);
    flipShapes(editor, ['a'], 'vertical');
    expect(editor.getShape('a')!.y).toBeCloseTo(60);
  });

  it('negates rotation', () => {
    const editor = makeEditor([rect('a', 0, 0, 40, 20, { rotation: 0.4 })]);
    flipShapes(editor, ['a'], 'horizontal');
    expect(editor.getShape('a')!.rotation).toBeCloseTo(-0.4);
  });

  it('turns a polygon a half turn for an up-down flip', () => {
    const editor = makeEditor([
      {
        ...base('p'),
        type: 'polygon' as const,
        props: {
          w: 40,
          h: 20,
          kind: 'triangle',
          color: '#111',
          fillStyle: 'none',
          dash: 'solid',
          size: 2,
        },
      } as unknown as Shape,
    ]);
    flipShapes(editor, ['p'], 'vertical');
    expect(editor.getShape('p')!.rotation).toBeCloseTo(Math.PI);
    // And back: the flip is its own inverse.
    flipShapes(editor, ['p'], 'vertical');
    expect(editor.getShape('p')!.rotation).toBeCloseTo(0);
  });

  it('mirrors ink points and the stylus lean with them', () => {
    const editor = makeEditor([
      {
        ...base('d'),
        type: 'draw' as const,
        props: {
          points: [
            { x: 0, y: 0, tiltX: 0.5 },
            { x: 30, y: 10, tiltX: 0.5 },
            { x: 30, y: 20, tiltX: 0.5 },
          ],
          isClosed: false,
          color: '#111',
          size: 4,
          dash: 'solid',
          fillStyle: 'none',
        },
      } as unknown as Shape,
    ]);
    const before = boundsOf(editor, 'd');
    flipShapes(editor, ['d'], 'horizontal');
    const shape = editor.getShape('d')! as Extract<Shape, { type: 'draw' }>;
    // The two samples that sat at the right end of the stroke are now its left
    // end, and the stroke as a whole has not moved: it was alone in the
    // selection, so its own box is the mirror line.
    expect(shape.props.points.map((p) => p.x)).toEqual([-0, -30, -30]);
    expect(boundsOf(editor, 'd').minX).toBeCloseTo(before.minX);
    expect(boundsOf(editor, 'd').maxX).toBeCloseTo(before.maxX);
    expect(shape.props.points[0]!.tiltX).toBeCloseTo(-0.5);
  });

  it('reverses a connector bend', () => {
    const editor = makeEditor([
      {
        ...base('l'),
        type: 'line' as const,
        props: {
          points: [
            { x: 0, y: 0 },
            { x: 60, y: 0 },
          ],
          color: '#111',
          size: 2,
          dash: 'solid',
          bend: 20,
          spline: 'linear',
        },
      } as unknown as Shape,
    ]);
    flipShapes(editor, ['l'], 'horizontal');
    const line = editor.getShape('l')! as Extract<Shape, { type: 'line' }>;
    expect(line.props.bend).toBeCloseTo(-20);
    expect(line.props.points[0]!.x).toBeCloseTo(0);
    expect(line.props.points[1]!.x).toBeCloseTo(-60);
  });

  it('mirrors a binding anchor only when its target is flipped too', () => {
    const arrow = {
      ...base('arrow'),
      type: 'arrow' as const,
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 60, y: 0 },
        ],
        color: '#111',
        size: 2,
        dash: 'solid',
        arrowStart: false,
        arrowEnd: true,
        bend: 0,
        topology: 'straight',
        bindings: {
          start: { shapeId: 'a', anchor: { x: 0.25, y: 0.5 } },
          end: { shapeId: 'outside', anchor: { x: 0.25, y: 0.5 } },
        },
      },
    } as unknown as Shape;
    const editor = makeEditor([
      rect('a', 0, 0),
      rect('outside', 400, 0),
      arrow,
    ]);
    flipShapes(editor, ['a', 'arrow'], 'horizontal');
    const flipped = editor.getShape('arrow')! as Extract<
      Shape,
      { type: 'arrow' }
    >;
    expect(flipped.props.bindings!.start!.anchor.x).toBeCloseTo(0.75);
    expect(flipped.props.bindings!.end!.anchor.x).toBeCloseTo(0.25);
  });

  it('moves an equation without turning it', () => {
    const editor = makeEditor([
      rect('a', 0, 0),
      {
        ...base('eq'),
        type: 'equation' as const,
        x: 200,
        y: 0,
        rotation: 0.3,
        props: { latex: 'x', color: '#111', fontSize: 24, w: 40, h: 20 },
      } as unknown as Shape,
    ]);
    flipShapes(editor, ['a', 'eq'], 'horizontal');
    // Mirrored box, same tilt: a flipped diagram must not leave its labels
    // mirrored or upside down.
    expect(editor.getShape('eq')!.rotation).toBeCloseTo(0.3);
    expect(boundsOf(editor, 'eq').minX).toBeLessThan(
      boundsOf(editor, 'a').minX,
    );
  });

  it('skips a locked root', () => {
    const editor = makeEditor([
      rect('locked', 0, 0, 40, 20, { locked: true }),
      rect('free', 200, 0),
    ]);
    flipShapes(editor, ['locked'], 'horizontal');
    expect(editor.getShape('locked')!.x).toBe(0);
  });

  it('mirrors a group by its children, locked ones included', () => {
    const editor = makeEditor([
      { ...base('g'), type: 'group' as const, props: {} } as unknown as Shape,
      rect('near', 0, 0, 40, 20, { parentId: 'g' }),
      rect('far', 200, 0, 40, 20, { parentId: 'g', locked: true }),
    ]);
    flipShapes(editor, ['g'], 'horizontal');
    expect(editor.getShape('near')!.x).toBeCloseTo(200);
    expect(editor.getShape('far')!.x).toBeCloseTo(0);
    // The container itself is not geometry and is left untouched.
    expect(editor.getShape('g')!.x).toBe(0);
  });
});
