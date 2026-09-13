import { describe, it, expect, vi } from 'vitest';
import { react } from '@tldraw/state';
import {
  type Shape,
  type RectangleShape,
  type FrameShape,
} from '@whiteboard/shared';
import '../shapes/register';
import { CanvasScene } from './scene';
import { SpatialIndex } from '../spatial-index';
import { shapeRotatedBounds } from '../shape-bounds';
import { intersectConvexPolygons, polygonCss } from './clipping';
import { inverse, multiply, rotationAt, transformPoint } from './matrix';
import { hitTestCanvas } from './hit-test';

export const rectangle = (
  id: string,
  patch: Partial<RectangleShape> = {},
): RectangleShape => ({
  id,
  type: 'rectangle',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a0',
  props: {
    w: 100,
    h: 80,
    color: '#000',
    fillStyle: 'solid',
    dash: 'solid',
    size: 2,
  },
  ...patch,
});
const frame = (id: string, patch: Partial<FrameShape> = {}): FrameShape => ({
  id,
  type: 'frame',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a0',
  props: { w: 100, h: 100, name: 'Frame' },
  ...patch,
});
function setup(initial: Shape[]) {
  const shapes = new Map(initial.map((s) => [s.id, s]));
  const index = new SpatialIndex();
  for (const s of initial)
    if (s.type !== 'group') index.insert(s.id, shapeRotatedBounds(s));
  const scene = new CanvasScene(index);
  scene.apply(shapes, null);
  const update = (shape: Shape) => {
    shapes.set(shape.id, shape);
    index.insert(shape.id, shapeRotatedBounds(shape));
    scene.apply(shapes, new Set([shape.id]));
  };
  return { shapes, index, scene, update };
}

describe('canvas scene', () => {
  it('isolates transform, content, and membership notifications', () => {
    const a = rectangle('a'),
      b = rectangle('b');
    const { scene, update } = setup([a, b]);
    const content = vi.fn(),
      transform = vi.fn(),
      unrelated = vi.fn(),
      membership = vi.fn();
    const stops = [
      react('content', () => content(scene.record('a').content.get())),
      react('transform', () => transform(scene.record('a').presentation.get())),
      react('other', () => unrelated(scene.record('b').presentation.get())),
      react('membership', () => membership(scene.ids.get())),
    ];
    update({ ...a, x: 200, y: 80, rotation: 1, index: 'a2' });
    expect(transform).toHaveBeenCalledTimes(2);
    expect(content).toHaveBeenCalledTimes(1);
    expect(unrelated).toHaveBeenCalledTimes(1);
    expect(membership).toHaveBeenCalledTimes(1);
    update({ ...a, props: { ...a.props, color: '#f00' } });
    expect(content).toHaveBeenCalledTimes(2);
    stops.forEach((stop) => stop());
  });

  it('propagates ancestor masks and opacity without invalidating child content', () => {
    const parent = frame('parent');
    const child = rectangle('child', { x: 60, parentId: 'parent' });
    const { scene, update } = setup([parent, child]);
    const node = scene.record('child');
    const content = node.content.get();
    const oldMask = node.presentation.get().clipPath;
    update({ ...parent, rotation: Math.PI / 4, opacity: 0.5 });
    expect(node.presentation.get().clipPath).not.toBe(oldMask);
    expect(node.presentation.get().opacity).toBe('0.5');
    expect(node.content.get()).toBe(content);
    expect(node.presentation.get().transform).toBe('matrix(1,0,0,1,60,0)');
  });

  it('gives stable id order and hierarchical paint order, including ties', () => {
    const a = rectangle('a', { index: 'a9', parentId: 'z' });
    const z = frame('z');
    const b = rectangle('b', { index: 'a1' });
    const { scene, update } = setup([a, b, z]);
    const ids = scene.ids.get();
    expect(ids).toEqual(['a', 'b', 'z']);
    expect(scene.record('z').z.get()).toBeLessThan(scene.record('a').z.get());
    expect(scene.record('a').z.get()).toBeLessThan(scene.record('b').z.get());
    update({ ...a, parentId: null });
    expect(scene.ids.get()).toBe(ids);
    expect(scene.record('a').z.get()).toBeGreaterThan(
      scene.record('b').z.get(),
    );
  });

  it('culls with the index, retains selected/editing shapes, and reuses subcell queries', () => {
    const { scene, index } = setup([
      rectangle('near'),
      rectangle('far', { x: 100000 }),
    ]);
    scene.viewport.set({ width: 800, height: 600 });
    const search = vi.spyOn(index, 'search');
    const stop = react('visibility', () => scene.visible.get());
    expect(scene.visible.get().has('far')).toBe(false);
    scene.camera.set({ x: 0.001, y: 0.001, z: 1 });
    expect(search).toHaveBeenCalledTimes(1);
    scene.ui.set({ ...scene.ui.get(), pinned: new Set(['far']) });
    expect(scene.visible.get().has('far')).toBe(true);
    stop();
  });

  it('keeps offscreen descendants of a selected container unculled', () => {
    const { scene } = setup([
      frame('parent', { x: 100000 }),
      rectangle('child', { x: 100010, parentId: 'parent' }),
    ]);
    scene.viewport.set({ width: 800, height: 600 });
    expect(scene.visible.get().has('child')).toBe(false);
    scene.ui.set({ ...scene.ui.get(), pinned: new Set(['parent']) });
    expect(scene.visible.get().has('child')).toBe(true);
  });

  it('invalidates content for in-place point edits from document diffs', () => {
    const stroke: Shape = {
      id: 'ink',
      type: 'draw',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
        color: '#000',
        size: 3,
        dash: 'solid',
        isClosed: false,
        simulatePressure: true,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      },
    };
    const { scene, shapes } = setup([stroke]);
    const before = scene.record('ink').content.get();
    stroke.props.points[1] = { x: 30, y: 20 };
    shapes.set('ink', { ...stroke });
    scene.apply(shapes, new Set(['ink']), new Set(['ink']));
    expect(scene.record('ink').content.get()).not.toBe(before);
  });

  it('recovers from missing parents and cycles', () => {
    const child = rectangle('child', { parentId: 'parent' });
    const { scene, update } = setup([child]);
    expect(scene.record('child').presentation.get().clipPath).toBe('none');
    update(frame('parent', { parentId: 'child', rotation: 0.5 }));
    expect(scene.record('child').presentation.get().clipPath).toContain(
      'polygon(',
    );
    expect(scene.ids.get()).toEqual(['child', 'parent']);
  });
});

describe('affine transforms and masks', () => {
  it('round-trips composed transforms at negative/large coordinates', () => {
    const m = multiply(
      rotationAt(-100000, 8000, 0.7, 20, 30),
      rotationAt(60, -15, -0.3, 0, 0),
    );
    const p = { x: -40, y: 150 };
    const result = transformPoint(inverse(m), transformPoint(m, p));
    expect(result.x).toBeCloseTo(p.x, 7);
    expect(result.y).toBeCloseTo(p.y, 7);
  });
  it('intersects nested masks in either winding and keeps empty masks empty', () => {
    const a = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    const b = a.map((p) => ({ x: p.x + 50, y: p.y + 20 }));
    const intersection = intersectConvexPolygons(a, b.reverse());
    expect(intersection).toHaveLength(4);
    expect(Math.min(...intersection.map((p) => p.x))).toBe(50);
    expect(Math.max(...intersection.map((p) => p.y))).toBe(100);
    expect(
      intersectConvexPolygons(
        a,
        b.map((p) => ({ ...p, x: p.x + 200 })),
      ),
    ).toEqual([]);
    expect(polygonCss([])).not.toBe('none');
  });
});

describe('scene picking', () => {
  const options = { zoom: 1, isEligible: () => true };
  it('rejects clipped child pixels and picks the visually topmost sibling', () => {
    const f = frame('frame'),
      child = rectangle('child', { x: 70, parentId: f.id, index: 'a9' });
    const cover = rectangle('cover', { x: 80, index: 'a1' });
    const { shapes, index } = setup([f, child, cover]);
    expect(
      hitTestCanvas([...shapes.values()], index, { x: 90, y: 40 }, 0, options)
        ?.id,
    ).toBe('cover');
    shapes.delete('cover');
    index.remove('cover');
    expect(
      hitTestCanvas([...shapes.values()], index, { x: 140, y: 40 }, 0, options),
    ).toBeNull();
  });
  it('finds zoom-adaptive frame labels outside the spatial bounds', () => {
    const { shapes, index } = setup([frame('frame')]);
    expect(
      hitTestCanvas([...shapes.values()], index, { x: 10, y: -15 }, 0, options)
        ?.id,
    ).toBe('frame');
  });
  it('keeps picking current after edits that reuse the cached paint order', () => {
    const { shapes, index } = setup([
      rectangle('box'),
      rectangle('cover', { x: 80, index: 'a1' }),
    ]);
    const pick = (x: number) =>
      hitTestCanvas([...shapes.values()], index, { x, y: 40 }, 0, options)?.id ??
      null;
    expect(pick(90)).toBe('cover');
    // Same ids in the same order: the cache is carried over, so the moved
    // shape must still be picked at its new position and not its old one.
    shapes.set('cover', rectangle('cover', { x: 300, index: 'a1' }));
    index.insert('cover', shapeRotatedBounds(shapes.get('cover')!));
    expect(pick(90)).toBe('box');
    expect(pick(310)).toBe('cover');
    // Reordering invalidates it: 'box' now paints above the overlapping cover.
    shapes.set('cover', rectangle('cover', { x: 80, index: 'a1' }));
    shapes.set('box', rectangle('box', { index: 'a2' }));
    index.insert('cover', shapeRotatedBounds(shapes.get('cover')!));
    expect(pick(90)).toBe('box');
  });
  it('lets frame interiors pass through to lower geometry', () => {
    const { shapes, index } = setup([
      rectangle('box'),
      frame('frame', { index: 'a1' }),
    ]);
    expect(
      hitTestCanvas([...shapes.values()], index, { x: 40, y: 40 }, 0, options)
        ?.id,
    ).toBe('box');
  });
});
