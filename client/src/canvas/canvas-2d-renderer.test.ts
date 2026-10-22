import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import {
  REPROJECT_BAND,
  composeShapeTransform,
  evictIdle,
  exposedEdges,
  impostorCoverage,
  isDetailedEnough,
  reprojection,
  reusableInk,
  withinReprojectBand,
} from './canvas-2d-renderer';
import { shapeMatrix } from './engine/scene';
import type { Matrix } from './engine/matrix';
import { drawUtil } from './shapes/draw';

const BOX = { x: 0, y: 0, w: 4, h: 4 };

const at = (
  forceSolid: boolean,
  dashStyle: string,
  errorLimit: number,
  box: typeof BOX | null = null,
) => ({ forceSolid, dashStyle, errorLimit, box });

describe('ink cache reuse across LOD bands', () => {
  it('reuses an entry conditioned for exactly this zoom', () => {
    expect(isDetailedEnough(at(false, 'solid', 0), false, 'solid', 0, false)).toBe(
      true,
    );
  });

  it('reuses a path simplified for a closer camera', () => {
    expect(isDetailedEnough(at(false, 'solid', 0), false, 'solid', 2, false)).toBe(
      true,
    );
  });

  // Zooming in is the one direction that needs detail the entry does not have.
  it('rejects a path simplified for a further camera', () => {
    expect(isDetailedEnough(at(false, 'solid', 2), false, 'solid', 0, false)).toBe(
      false,
    );
  });

  it('reuses a full-width outline where a centerline would now do', () => {
    expect(isDetailedEnough(at(false, 'solid', 0), true, 'solid', 0, false)).toBe(
      true,
    );
  });

  it('rejects a centerline once the outline is wanted again', () => {
    expect(isDetailedEnough(at(true, 'solid', 0), false, 'solid', 0, false)).toBe(
      false,
    );
  });

  it('reuses a pattern where the LOD has since dropped to solid', () => {
    expect(isDetailedEnough(at(false, 'dashed', 0), true, 'solid', 0, false)).toBe(
      true,
    );
  });

  it('rejects a solid path once the pattern reads again', () => {
    expect(isDetailedEnough(at(false, 'solid', 0), false, 'dashed', 0, false)).toBe(
      false,
    );
  });

  it('rejects a dashed entry when dotted is wanted', () => {
    expect(
      isDetailedEnough(at(false, 'dashed', 0), false, 'dotted', 0, false),
    ).toBe(false);
  });

  // The impostor is the term that removes the most detail, so it reads the
  // same way round as the others: geometry answers either request, a box only
  // answers a request for a box.
  it('reuses real geometry where a box would now do', () => {
    expect(isDetailedEnough(at(false, 'solid', 0), false, 'solid', 0, true)).toBe(
      true,
    );
  });

  it('rejects a box once the geometry reads again', () => {
    expect(
      isDetailedEnough(at(false, 'solid', 0, BOX), false, 'solid', 0, false),
    ).toBe(false);
  });

  it('reuses a box while it is still too small to read', () => {
    expect(
      isDetailedEnough(at(false, 'solid', 0, BOX), false, 'solid', 0, true),
    ).toBe(true);
  });
});

// `isDetailedEnough` answers what a MOVING camera may reuse. Every case above
// passed while a still board was rebuilding every visible shape on every
// repaint, because the decision that consumes the predicate read it as a
// ternary: an exactly-right entry is also detailed enough, so it took the
// moving arm and came back false at rest. These are the cases at that level.
describe('reusing ink at rest vs mid-gesture', () => {
  const moving = true;
  const rest = false;

  it('reuses an exactly-matching entry at rest', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 0, false, rest),
    ).toBe(true);
  });

  it('reuses an exactly-matching entry mid-gesture', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 0, false, moving),
    ).toBe(true);
  });

  it('keeps an over-detailed entry mid-gesture', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 2, false, moving),
    ).toBe(true);
  });

  it('re-conditions that same over-detailed entry once the camera settles', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 2, false, rest),
    ).toBe(false);
  });

  it('keeps a full-width outline where a centerline would now do, mid-gesture', () => {
    expect(
      reusableInk(at(false, 'solid', 0), true, 'solid', 0, false, moving),
    ).toBe(true);
  });

  it('narrows that outline to a centerline at rest', () => {
    expect(
      reusableInk(at(false, 'solid', 0), true, 'solid', 0, false, rest),
    ).toBe(false);
  });

  it('keeps real geometry where a box would now do, mid-gesture', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 0, true, moving),
    ).toBe(true);
  });

  it('drops to the impostor at rest', () => {
    expect(
      reusableInk(at(false, 'solid', 0), false, 'solid', 0, true, rest),
    ).toBe(false);
  });

  it('rebuilds an under-detailed entry either way', () => {
    expect(
      reusableInk(at(false, 'solid', 2), false, 'solid', 0, false, moving),
    ).toBe(false);
    expect(
      reusableInk(at(false, 'solid', 2), false, 'solid', 0, false, rest),
    ).toBe(false);
  });
});

// The renderer sends one `setTransform` of the composed matrix where it used
// to send `setTransform(world)` plus `transform(shapeMatrix(shape))`, and the
// unrotated case skips `shapeMatrix` altogether. Both shortcuts have to land
// on exactly the matrix the two-call form did.
describe('composing the world and shape transforms', () => {
  /** `world` post-multiplied by `m`, which is what `ctx.transform` does. */
  const product = (world: Matrix, m: Matrix): Matrix => {
    const [a, b, c, d, e, f] = world;
    return [
      a * m[0] + c * m[1],
      b * m[0] + d * m[1],
      a * m[2] + c * m[3],
      b * m[2] + d * m[3],
      a * m[4] + c * m[5] + e,
      b * m[4] + d * m[5] + f,
    ];
  };

  const draw = (x: number, y: number, rotation: number): Shape => ({
    id: 'd',
    type: 'draw',
    x,
    y,
    rotation,
    index: 'a1',
    parentId: undefined,
    props: {
      ...drawUtil.getDefaultProps(),
      points: [
        { x: 0, y: 0 },
        { x: 40, y: 20 },
      ],
    },
  });

  const out = (): [number, number, number, number, number, number] => [
    1, 0, 0, 1, 0, 0,
  ];
  // A camera: uniform zoom with a pan offset.
  const camera: Matrix = [2, 0, 0, 2, -30, 17];

  it('matches the two-call form for an unrotated shape', () => {
    const shape = draw(11, 23, 0);
    expect(composeShapeTransform(camera, shape, out())).toEqual(
      product(camera, shapeMatrix(shape)),
    );
  });

  it('matches the two-call form for a rotated shape', () => {
    const shape = draw(11, 23, 0.7);
    expect(composeShapeTransform(camera, shape, out())).toEqual(
      product(camera, shapeMatrix(shape)),
    );
  });

  it('puts the shape origin where the camera puts it', () => {
    const m = composeShapeTransform(camera, draw(11, 23, 0), out());
    expect([m[4], m[5]]).toEqual([2 * 11 - 30, 2 * 23 + 17]);
  });

  it('writes into the caller`s array rather than allocating one', () => {
    const scratch = out();
    expect(composeShapeTransform(camera, draw(4, 5, 0), scratch)).toBe(scratch);
    composeShapeTransform(camera, draw(6, 7, 0.4), scratch);
    expect(scratch).toEqual(
      composeShapeTransform(camera, draw(6, 7, 0.4), out()),
    );
  });
});


// A shape whose whole bounding box lands on a few pixels contributes a smudge,
// and every path command it carries lands on those same pixels. The impostor
// is one rect at the weight the geometry would have left.
describe('impostor coverage', () => {
  const line = (length: number) => [
    { x: 0, y: 0 },
    { x: length, y: 0 },
  ];

  it('weights a sparse stroke by how little of its box it inks', () => {
    // A 100-long, 4-wide stroke across a 100x100 box: ~4% plus its cap.
    expect(impostorCoverage(line(100), 4, 100, 100)).toBeCloseTo(0.0416, 4);
  });

  it('saturates rather than exceeding a full box', () => {
    expect(impostorCoverage(line(100), 40, 100, 20)).toBe(1);
  });

  // A pen dot has no length at all; weighting it by length alone erases it.
  it('keeps a zero-length dot visible', () => {
    expect(impostorCoverage([{ x: 0, y: 0 }], 6, 6, 6)).toBe(1);
  });

  it('is scale-free — the same stroke at any size reads the same', () => {
    expect(impostorCoverage(line(50), 2, 50, 50)).toBeCloseTo(
      impostorCoverage(line(100), 4, 100, 100),
      6,
    );
  });

  it('treats a degenerate box as inking nothing', () => {
    expect(impostorCoverage(line(10), 2, 0, 10)).toBe(0);
  });
});

// The zoom counterpart to the pan blit: within one band the pixels already on
// the canvas still say what the geometry would, just at the wrong size.
describe('reprojecting a bitmap across a zoom', () => {
  const dpr = 2;
  /** Where camera `c` puts world point `wx`, in device pixels. */
  const device = (c: { z: number; e: number }, wx: number) =>
    (wx * c.z + c.e) * dpr;

  it('is the identity when nothing moved', () => {
    const c = { z: 0.4, e: 17, f: -3 };
    expect(reprojection(c, c, dpr)).toEqual({ s: 1, dx: 0, dy: 0 });
  });

  it('reduces to the pure translation a pan already does', () => {
    const from = { z: 0.5, e: 10, f: 20 };
    const to = { z: 0.5, e: 13, f: 24 };
    expect(reprojection(from, to, dpr)).toEqual({ s: 1, dx: 6, dy: 8 });
  });

  it('puts a world point exactly where the new camera puts it', () => {
    const from = { z: 0.5, e: 10, f: 20 };
    const to = { z: 0.62, e: -40, f: 7 };
    const { s, dx } = reprojection(from, to, dpr);
    for (const wx of [-300, 0, 44, 1290]) {
      // The source pixel for `wx`, carried through the blit's own transform.
      expect(device(from, wx) * s + dx).toBeCloseTo(device(to, wx), 6);
    }
  });

  it('shrinks the bitmap when zooming out and grows it when zooming in', () => {
    expect(reprojection({ z: 1, e: 0, f: 0 }, { z: 0.8, e: 0, f: 0 }, 1).s).toBe(
      0.8,
    );
    expect(reprojection({ z: 1, e: 0, f: 0 }, { z: 1.2, e: 0, f: 0 }, 1).s).toBe(
      1.2,
    );
  });
});

describe('the reprojection band', () => {
  it('accepts either direction inside one octave half-step', () => {
    expect(withinReprojectBand(1, 1.3)).toBe(true);
    expect(withinReprojectBand(1, 0.75)).toBe(true);
  });

  it('is symmetric in the scale factor', () => {
    expect(withinReprojectBand(1, REPROJECT_BAND)).toBe(true);
    expect(withinReprojectBand(1, 1 / REPROJECT_BAND)).toBe(true);
  });

  it('rejects a stretch past the band, so the frame repaints instead', () => {
    expect(withinReprojectBand(1, REPROJECT_BAND * 1.001)).toBe(false);
    expect(withinReprojectBand(1, 1 / (REPROJECT_BAND * 1.001))).toBe(false);
  });

  it('depends only on the ratio, not on where in the zoom range it sits', () => {
    expect(withinReprojectBand(0.05, 0.06)).toBe(withinReprojectBand(5, 6));
  });

  // The bench's zoom ramp steps 4% a frame, which is what makes a band worth
  // having: a repaint every ninth frame rather than every one.
  it('spans several frames of a 4%-per-frame zoom', () => {
    let z = 1;
    let frames = 0;
    while (withinReprojectBand(1, z)) {
      z *= 1.04;
      frames++;
    }
    expect(frames).toBe(9);
  });
});

describe('the edges a reprojection leaves uncovered', () => {
  const W = 100;
  const H = 60;

  it('exposes nothing when the bitmap still covers the viewport', () => {
    expect(exposedEdges({ x: 0, y: 0, w: W, h: H }, W, H, 0)).toEqual([]);
  });

  // Zooming in over-covers, which is the direction that costs no repaint at
  // all — the whole frame is one drawImage.
  it('exposes nothing when the bitmap over-covers it', () => {
    expect(exposedEdges({ x: -20, y: -12, w: 140, h: 84 }, W, H, 0)).toEqual([]);
  });

  it('exposes all four sides when the bitmap shrinks inside it', () => {
    expect(exposedEdges({ x: 10, y: 6, w: 80, h: 48 }, W, H, 0)).toEqual([
      [0, 0, 10, H],
      [90, 0, 10, H],
      [0, 0, W, 6],
      [0, 54, W, 6],
    ]);
  });

  it('widens each strip inwards by the seam', () => {
    expect(exposedEdges({ x: 10, y: 0, w: 90, h: H }, W, H, 2)).toEqual([
      [0, 0, 12, H],
    ]);
  });

  // The pure translation is the case this generalizes, and it has to keep
  // producing exactly the strips it produced before.
  describe('reduces to the strips a pan exposes', () => {
    const seam = 2;
    /** The two-sided form the translation blit was written as. */
    const panEdges = (dx: number, dy: number) => {
      const edges: [number, number, number, number][] = [];
      if (dx > 0) edges.push([0, 0, dx + seam, H]);
      else if (dx < 0) edges.push([W + dx - seam, 0, -dx + seam, H]);
      if (dy > 0) edges.push([0, 0, W, dy + seam]);
      else if (dy < 0) edges.push([0, H + dy - seam, W, -dy + seam]);
      return edges;
    };

    for (const [dx, dy] of [
      [7, 5],
      [-7, -5],
      [7, -5],
      [-7, 5],
      [0, 5],
      [7, 0],
      [0, 0],
    ] as const) {
      it(`matches at dx=${dx} dy=${dy}`, () => {
        expect(exposedEdges({ x: dx, y: dy, w: W, h: H }, W, H, seam)).toEqual(
          panEdges(dx, dy),
        );
      });
    }
  });
});

describe('evicting idle cache entries', () => {
  it('drops only entries last painted before the cutoff', () => {
    const store = new Map([
      ['stale', { used: 10 }],
      ['edge', { used: 50 }],
      ['fresh', { used: 90 }],
    ]);
    evictIdle(store, 50);
    expect([...store.keys()]).toEqual(['edge', 'fresh']);
  });
});
