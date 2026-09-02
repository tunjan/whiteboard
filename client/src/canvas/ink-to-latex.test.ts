import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  DrawShape,
  ImageShape,
  RectangleShape,
  Shape,
} from '@whiteboard/shared';
import './shapes/register';
import { convertibleShapeIds, placement } from './ink-to-latex';
import { editor, loadBoard } from './use-document-store';

// Real MathJax output at the measuring size (fontSize 16), captured from
// `x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}`: width 166.12, height 42.328. A
// two-level fraction like this is what makes the clamp load-bearing — MathJax
// sets it far more tightly than a hand ever does.
const FRACTION_RENDER = { width: 166.12, height: 42.328 };
const boundsOfHeight = (height: number) => ({
  minX: 0,
  minY: 0,
  maxX: 100,
  maxY: height,
});

describe('placement', () => {
  it('matches the ink height when that lands inside the manual size range', () => {
    // (120 / 42.328) * 16 ≈ 45.4 before clamping — pick a height that lands
    // inside [16, 40] instead, so this case exercises the unclamped path.
    const bounds = boundsOfHeight(60); // -> fontSize ≈ 22.7
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBeGreaterThan(16);
    expect(result.fontSize).toBeLessThan(40);
    expect(result.h).toBeCloseTo(60, 0);
  });

  // An entirely ordinary two-line handwritten fraction — well short of a full
  // page of working — already asks for a fontSize past the panel's own
  // largest manual preset. This is the case that used to render oversized.
  it('caps an ordinary two-line fraction at the largest manual preset', () => {
    const bounds = boundsOfHeight(180); // -> fontSize ≈ 68 unclamped
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBe(40);
  });

  it('floors a tiny scrawl at the smallest manual preset', () => {
    const bounds = boundsOfHeight(10); // -> fontSize ≈ 3.8 unclamped
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.fontSize).toBe(16);
  });

  it('centers the placed box on the ink bounds', () => {
    const bounds = { minX: 100, minY: 200, maxX: 300, maxY: 260 };
    const result = placement(FRACTION_RENDER, bounds);
    expect(result.x + result.w / 2).toBeCloseTo(200, 5);
    expect(result.y + result.h / 2).toBeCloseTo(230, 5);
  });
});

function draw(id: string): DrawShape {
  return {
    id,
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      isClosed: false,
      color: '#000000',
      size: 4,
    },
  };
}

function image(id: string): ImageShape {
  return {
    id,
    type: 'image',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a2',
    props: {
      blobId: 'a'.repeat(64),
      w: 100,
      h: 60,
      naturalWidth: 200,
      naturalHeight: 120,
    },
  };
}

function rectangle(id: string): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a3',
    props: {
      w: 10,
      h: 10,
      color: '#000000',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
    },
  };
}

describe('convertibleShapeIds', () => {
  let dispose: () => void;
  beforeEach(() => {
    dispose = loadBoard('test-ink-to-latex', { persist: false, collab: false });
  });
  afterEach(() => dispose());

  const add = (...shapes: Shape[]) => {
    for (const shape of shapes) editor.createShape(shape);
    return shapes.map((s) => s.id);
  };

  it('accepts strokes', () => {
    const ids = add(draw('d1'), draw('d2'));
    expect(convertibleShapeIds(ids)).toEqual(ids);
  });

  // The point of this feature: a pasted screenshot of a formula converts the
  // same way a scrawl of it does.
  it('accepts a pasted image', () => {
    const ids = add(image('i1'));
    expect(convertibleShapeIds(ids)).toEqual(ids);
  });

  // An annotated screenshot is one piece of mathematics; both halves are shown
  // to the model rather than one of them being silently dropped.
  it('accepts ink over an image', () => {
    const ids = add(image('i1'), draw('d1'));
    expect(convertibleShapeIds(ids)).toEqual(ids);
  });

  it('rejects a selection holding anything else', () => {
    const ids = add(draw('d1'), rectangle('r1'));
    expect(convertibleShapeIds(ids)).toBeNull();
  });

  it('rejects an empty selection', () => {
    expect(convertibleShapeIds([])).toBeNull();
  });
});
