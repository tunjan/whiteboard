import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import {
  buildPaint,
  lodDash,
  CANVAS_PAINTED_TYPES,
  DOM_SHAPE_TYPES,
  type PaintEnv,
  type PaintOp,
  type PathOp,
  type TextOp,
} from './canvas-2d-paint';
import { shapeRegistry } from './shapes/shape-registry';
import './shapes/register';

/** Paints resolve to themselves, so an op's colour is the one the shape asked
 *  for rather than whatever the test environment's stylesheet says. */
const env = (overrides: Partial<PaintEnv> = {}): PaintEnv => ({
  resolve: (input) => input,
  lod: { patternCutoff: 0, detail: 'high' },
  ...overrides,
});

const base = { id: 'a', x: 30, y: 40, rotation: 0, index: 'a1' };

const rectangle = (props: Record<string, unknown> = {}): Shape =>
  ({
    ...base,
    type: 'rectangle',
    props: {
      w: 100,
      h: 60,
      color: '#111111',
      fillStyle: 'none',
      dash: 'solid',
      size: 2,
      ...props,
    },
  }) as Shape;

const paths = (ops: PaintOp[]) =>
  ops.filter((op): op is PathOp => op.kind === 'path');

describe('the canvas/DOM split', () => {
  it('has a home for every registered shape type', () => {
    for (const util of shapeRegistry.list())
      expect(
        CANVAS_PAINTED_TYPES.has(util.type) || DOM_SHAPE_TYPES.has(util.type),
      ).toBe(true);
  });

  it('never claims a type for both', () => {
    for (const type of DOM_SHAPE_TYPES)
      expect(CANVAS_PAINTED_TYPES.has(type)).toBe(false);
  });
});

describe("painting in the shape's own coordinates", () => {
  // The context transform carries the position, exactly as the DOM layer's
  // per-shape container does. A `d` holding the page position would place the
  // shape twice.
  it('ignores where the shape sits on the page', () => {
    const here = buildPaint(rectangle(), env());
    const there = buildPaint(
      { ...(rectangle() as Shape), x: -900, y: 500 },
      env(),
    );
    expect(there).toEqual(here);
  });
});

describe('geometric shapes', () => {
  it('strokes a solid rectangle and fills nothing', () => {
    const ops = paths(buildPaint(rectangle(), env()));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.stroke).toBe('#111111');
    expect(ops[0]!.fill).toBeUndefined();
    expect(ops[0]!.width).toBe(2);
  });

  it('gives a solid fill the same 18% the SVG does', () => {
    const ops = paths(buildPaint(rectangle({ fillStyle: 'solid' }), env()));
    expect(ops[0]!.fill).toEqual({ kind: 'color', color: '#111111' });
    expect(ops[0]!.fillAlpha).toBeCloseTo(0.18);
  });

  it('carries the box with a hatch fill, since a clip has no bounds', () => {
    const ops = paths(
      buildPaint(rectangle({ fillStyle: 'crosshatch' }), env()),
    );
    expect(ops[0]!.fill).toEqual({
      kind: 'hatch',
      color: '#111111',
      crosshatch: true,
      w: 100,
      h: 60,
    });
  });

  // One dashed op per edge: a perimeter dashed in one pass lets a dash straddle
  // a corner, which is what `DashedOutline` exists to avoid.
  it('dashes each edge of a rectangle on its own length', () => {
    const ops = paths(buildPaint(rectangle({ dash: 'dashed' }), env()));
    expect(ops).toHaveLength(4);
    for (const op of ops) expect(op.dash?.length).toBe(2);
  });

  it('drops the pattern once the stroke is finer than the LOD cutoff', () => {
    const ops = paths(
      buildPaint(
        rectangle({ dash: 'dashed' }),
        env({ lod: { patternCutoff: 8, detail: 'high' } }),
      ),
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!.dash).toBeUndefined();
  });

  it('paints the hand-drawn outline as one path holding both passes', () => {
    const strokes = paths(buildPaint(rectangle({ dash: 'draw' }), env())).filter(
      (op) => op.stroke,
    );
    expect(strokes).toHaveLength(1);
    expect(strokes[0]!.stroke).toBe('#111111');
    expect(strokes[0]!.d.match(/[Mm]/g)).toHaveLength(2);
  });

  it('closes an ellipse dash over its own seam', () => {
    const ellipse = {
      ...base,
      type: 'ellipse',
      props: {
        w: 100,
        h: 100,
        color: '#111111',
        fillStyle: 'none',
        dash: 'dashed',
        size: 2,
      },
    } as Shape;
    const ops = paths(buildPaint(ellipse, env()));
    expect(ops).toHaveLength(1);
    expect(ops[0]!.dashOffset).toBeGreaterThan(0);
  });

  it('paints nothing for a group', () => {
    expect(
      buildPaint({ ...base, type: 'group', props: {} } as Shape, env()),
    ).toEqual([]);
  });
});

describe('connectors', () => {
  const arrow = (props: Record<string, unknown> = {}): Shape =>
    ({
      ...base,
      type: 'arrow',
      props: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: '#111111',
        size: 4,
        dash: 'solid',
        bend: 0,
        arrowEnd: true,
        ...props,
      },
    }) as Shape;

  it('paints the body and its head', () => {
    const ops = paths(buildPaint(arrow(), env()));
    expect(ops).toHaveLength(2);
  });

  it('leaves the head off when the shape has none', () => {
    const ops = paths(buildPaint(arrow({ arrowEnd: false }), env()));
    expect(ops).toHaveLength(1);
  });

  it('halos a label so it reads over whatever it crosses', () => {
    const ops = buildPaint(arrow({ label: 'flow' }), env());
    const label = ops.find((op): op is TextOp => op.kind === 'text');
    expect(label?.text).toBe('flow');
    expect(label?.halo?.color).toBe('var(--color-background)');
    expect(label?.align).toBe('center');
  });

  it('paints nothing for a connector with one end', () => {
    expect(buildPaint(arrow({ points: [{ x: 0, y: 0 }] }), env())).toEqual([]);
  });
});

describe('text', () => {
  const text = (props: Record<string, unknown> = {}): Shape =>
    ({
      ...base,
      type: 'text',
      props: {
        text: 'one\ntwo',
        color: '#111111',
        fontSize: 24,
        fontFamily: 'sans',
        fontWeight: 400,
        sizingMode: 'auto',
        width: 0,
        lineHeight: 1.2,
        align: 'start',
        ...props,
      },
    }) as Shape;

  it('paints one op per laid-out line', () => {
    const ops = buildPaint(text(), env());
    expect(ops.map((op) => (op as TextOp).text)).toEqual(['one', 'two']);
  });

  it('stacks the lines down the box', () => {
    const [first, second] = buildPaint(text(), env()) as TextOp[];
    expect(second!.y).toBeGreaterThan(first!.y);
  });

  it('paints nothing for an empty box', () => {
    expect(buildPaint(text({ text: '' }), env())).toEqual([]);
  });
});

describe('media', () => {
  const image = (props: Record<string, unknown> = {}): Shape =>
    ({
      ...base,
      type: 'image',
      props: {
        blobId: 'blob1',
        w: 200,
        h: 100,
        naturalWidth: 400,
        naturalHeight: 200,
        ...props,
      },
    }) as Shape;

  it('draws the bytes inside a rounded clip, under a border', () => {
    const ops = buildPaint(image(), env());
    const picture = ops.find((op) => op.kind === 'image');
    expect(picture).toMatchObject({ x: 0, y: 0, w: 200, h: 100, fit: 'none' });
    expect(picture && 'clip' in picture && picture.clip).toBeTruthy();
    expect(ops.at(-1)).toMatchObject({ kind: 'path', screenWidth: true });
  });

  // The crop is expressed as the sub-rect of the source that fills the box, so
  // the full image is scaled up and the clip keeps the part that was kept.
  it('scales the source so the crop fills the box', () => {
    const ops = buildPaint(
      image({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }),
      env(),
    );
    const picture = ops.find((op) => op.kind === 'image');
    expect(picture).toMatchObject({ w: 400, h: 100, x: -100 });
  });

  it('holds the place of an upload that has not landed', () => {
    const ops = buildPaint(image({ blobId: '' }), env());
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ kind: 'path' });
  });

  it('drops the drop shadow once it is sub-pixel', () => {
    const high = buildPaint(image(), env()).length;
    const low = buildPaint(
      image(),
      env({ lod: { patternCutoff: 0, detail: 'low' } }),
    ).length;
    expect(low).toBeLessThan(high);
  });

  it('draws the thumbnail once small on screen, the original as its stand-in', () => {
    const thumbed = image({ thumbBlobId: 'thumb1' });
    const far = buildPaint(
      thumbed,
      env({ lod: { patternCutoff: 0, detail: 'low', imageThumbCutoff: 512 } }),
    ).find((op) => op.kind === 'image');
    expect(far).toMatchObject({
      src: '/api/blobs/thumb1',
      fallback: '/api/blobs/blob1',
    });
    const near = buildPaint(thumbed, env()).find((op) => op.kind === 'image');
    expect(near).toMatchObject({
      src: '/api/blobs/blob1',
      fallback: '/api/blobs/thumb1',
    });
  });

  it('draws the original at any zoom when there is no thumbnail', () => {
    const picture = buildPaint(
      image(),
      env({ lod: { patternCutoff: 0, detail: 'low', imageThumbCutoff: 512 } }),
    ).find((op) => op.kind === 'image');
    expect(picture).toMatchObject({ src: '/api/blobs/blob1' });
    expect(picture && 'fallback' in picture && picture.fallback).toBeFalsy();
  });

  it('covers the video box with its thumbnail and a play badge', () => {
    const video = {
      ...base,
      type: 'video',
      props: { videoId: 'abc123', w: 320, h: 180 },
    } as Shape;
    const ops = buildPaint(video, env());
    const picture = ops.find((op) => op.kind === 'image');
    expect(picture).toMatchObject({ fit: 'slice' });
    expect(picture && 'src' in picture && picture.src).toContain('abc123');
  });
});

describe('frames', () => {
  const frame = {
    ...base,
    type: 'frame',
    props: { w: 400, h: 300, name: 'Sketches' },
  } as Shape;

  it('paints a card, a screen-width border, and the heading', () => {
    const ops = buildPaint(frame, env());
    expect(ops.map((op) => op.kind)).toEqual(['path', 'path', 'heading']);
    expect((ops[1] as PathOp).screenWidth).toBe(true);
  });

  // The heading's size, ellipsis and edge are all functions of the zoom, so it
  // stays an op and is laid out at paint time.
  it('leaves the heading unresolved at build time', () => {
    const heading = buildPaint(frame, env()).at(-1);
    expect(heading).toMatchObject({ kind: 'heading' });
    expect(heading && 'frame' in heading && heading.frame.x).toBe(0);
  });
});

describe('the LOD dash rule', () => {
  it('keeps a pattern on a stroke thick enough to carry it', () => {
    expect(lodDash('dashed', 8, { patternCutoff: 4, detail: 'high' })).toBe(
      'dashed',
    );
  });

  it('flattens one that is not', () => {
    expect(lodDash('dashed', 2, { patternCutoff: 4, detail: 'high' })).toBe(
      'solid',
    );
  });

  it('leaves a solid stroke alone', () => {
    expect(lodDash('solid', 1, { patternCutoff: 4, detail: 'high' })).toBe(
      'solid',
    );
  });
});
