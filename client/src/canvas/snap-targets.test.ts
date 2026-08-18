import { beforeEach, describe, expect, it } from 'vitest';
import type { Bounds, Shape } from '@whiteboard/shared';
import './shapes/register';
import type { Editor } from './editor';
import { snapTargetBounds, snapTargetShapes } from './snap-targets';
import { spatialIndex } from './use-document-store';
import { useCanvasUiStore } from './use-canvas-ui-store';

interface Spec {
  id: string;
  type?: Shape['type'];
  parentId?: string | null;
  x?: number;
  rotation?: number;
}

/** In-memory document indexed for the R-tree broad phase snapping uses. */
function makeEditor(specs: Spec[]): Editor {
  const map = new Map<string, Shape>();
  spatialIndex.clear();
  specs.forEach((spec, i) => {
    const x = spec.x ?? i * 200;
    map.set(spec.id, {
      id: spec.id,
      type: spec.type ?? 'rectangle',
      x,
      y: 0,
      rotation: spec.rotation ?? 0,
      index: `a${i}`,
      parentId: spec.parentId ?? null,
      props: { w: 40, h: 40, name: 'Frame' },
    } as unknown as Shape);
    // Groups derive their box from descendants and are never indexed as one.
    if (spec.type !== 'group') {
      spatialIndex.insert(spec.id, {
        minX: x,
        minY: 0,
        maxX: x + 40,
        maxY: 40,
      });
    }
  });
  return {
    getShape: (id) => map.get(id),
    getShapes: () => [...map.values()],
    createShape: () => {},
    updateShape: () => {},
    deleteShapes: () => {},
    transact: (fn) => fn(),
  };
}

const WORLD: Bounds = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };

const targetIds = (
  editor: Editor,
  moving: string[],
  ancestor: string | null,
): string[] =>
  snapTargetShapes(editor, new Set(moving), ancestor, WORLD)
    .map((shape) => shape.id)
    .sort();

describe('snap candidate scoping', () => {
  beforeEach(() => {
    useCanvasUiStore.setState({ snappingEnabled: true });
  });

  it('unrolls groups to their leaves and hides frame contents behind the frame', () => {
    const editor = makeEditor([
      { id: 'moving' },
      { id: 'plain' },
      { id: 'frame', type: 'frame' },
      { id: 'inFrame', parentId: 'frame' },
      { id: 'group', type: 'group' },
      { id: 'inGroup', parentId: 'group' },
    ]);

    // `inFrame` is represented by its frame; `inGroup` stands in for its group.
    expect(targetIds(editor, ['moving'], null)).toEqual([
      'frame',
      'inGroup',
      'plain',
    ]);
  });

  it('scopes candidates to the container the drag happens in', () => {
    const editor = makeEditor([
      { id: 'outside' },
      { id: 'frame', type: 'frame' },
      { id: 'movingInFrame', parentId: 'frame' },
      { id: 'siblingInFrame', parentId: 'frame' },
    ]);

    // Shapes outside the frame are out of scope; the frame itself is a target so
    // the drag can line up with its edges.
    expect(targetIds(editor, ['movingInFrame'], 'frame')).toEqual([
      'frame',
      'siblingInFrame',
    ]);
  });

  it('never offers a moving shape or its own frame as a target', () => {
    const editor = makeEditor([
      { id: 'frame', type: 'frame' },
      { id: 'child', parentId: 'frame' },
      { id: 'plain' },
    ]);

    // Dragging the frame moves its children too, so neither may guide it.
    expect(targetIds(editor, ['frame', 'child'], null)).toEqual(['plain']);
  });

  it('yields nothing while snapping is switched off', () => {
    const editor = makeEditor([{ id: 'moving' }, { id: 'plain' }]);
    useCanvasUiStore.setState({ snappingEnabled: false });

    expect(targetIds(editor, ['moving'], null)).toEqual([]);
  });

  it('transforms bounds feature points through shape rotation', () => {
    const editor = makeEditor([
      { id: 'moving', x: 200 },
      { id: 'rotated', x: 0, rotation: Math.PI / 4 },
    ]);

    const [target] = snapTargetBounds(editor, new Set(['moving']), null, WORLD);

    expect(target?.points[0]?.x).toBeCloseTo(20);
    expect(target?.points[0]?.y).toBeCloseTo(20 - 20 * Math.SQRT2);
    expect(target?.points[4]).toEqual({ x: 20, y: 20 });
  });
});
