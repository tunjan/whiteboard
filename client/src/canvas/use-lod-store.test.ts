// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { useCameraStore } from './use-camera-store';
import {
  INK_ERROR_SCREEN_PX,
  imageThumbCutoff,
  impostorCutoff,
  inkErrorLimit,
  patternCutoff,
  useLodStore,
} from './use-lod-store';

const setZoom = (z: number) =>
  useCameraStore.setState({ camera: { x: 0, y: 0, z } });

/** Publishes while `move` runs. Every mounted shape is a listener on each one,
 *  so this count is the per-camera-event cost multiplied by the shape count. */
function publishes(move: () => void): number {
  let n = 0;
  const stop = useLodStore.subscribe(() => n++);
  move();
  stop();
  return n;
}

beforeEach(() => setZoom(1));

describe('lod publishing', () => {
  it('publishes nothing on a pan', () => {
    expect(
      publishes(() =>
        useCameraStore.setState({ camera: { x: 40, y: 25, z: 1 } }),
      ),
    ).toBe(0);
  });

  it('publishes nothing across an ordinary pinch', () => {
    expect(
      publishes(() => {
        let z = 1;
        for (let i = 0; i < 20; i++) setZoom((z *= 1.04));
        for (let i = 0; i < 30; i++) setZoom((z /= 1.04));
      }),
    ).toBe(0);
  });

  it('publishes when an answer actually changes', () => {
    expect(publishes(() => setZoom(0.3))).toBe(1);
    expect(useLodStore.getState().detail).toBe('low');
    // …and then not again while every answer holds. 0.3 and 0.29 sit in the
    // same whole-unit cutoff bucket (5), which is the point of quantizing it.
    expect(publishes(() => setZoom(0.29))).toBe(0);
  });
});

describe('patternCutoff', () => {
  it('keeps every stroke patterned above the zoom threshold', () => {
    expect(patternCutoff(1)).toBe(0);
    expect(patternCutoff(0.5)).toBe(0);
  });

  it('rises as the camera pulls out, in whole world units', () => {
    expect(patternCutoff(0.4)).toBe(3);
    expect(patternCutoff(0.25)).toBe(6);
    expect(patternCutoff(0.1)).toBe(15);
  });
});

describe('inkErrorLimit', () => {
  it('renders the exact geometry until detail stops reading', () => {
    expect(inkErrorLimit(2)).toBe(0);
    expect(inkErrorLimit(1)).toBe(0);
    expect(inkErrorLimit(0.5)).toBe(0);
  });

  it('holds one budget per zoom octave, and doubles it across one', () => {
    // One value per octave is what makes an ordinary pinch publish nothing.
    expect(inkErrorLimit(0.26)).toBe(inkErrorLimit(0.49));
    expect(inkErrorLimit(0.13)).toBe(inkErrorLimit(0.25));
    expect(inkErrorLimit(0.25)).toBeCloseTo(2 * inkErrorLimit(0.49), 10);
  });

  it('never spends more than the budget it is quoted in', () => {
    // Taken from the band's upper edge, so the world-unit error it allows is
    // worth at most `INK_ERROR_SCREEN_PX` on screen and usually less.
    for (let zoom = 0.02; zoom < 0.5; zoom += 0.005) {
      expect(inkErrorLimit(zoom) * zoom).toBeLessThanOrEqual(
        INK_ERROR_SCREEN_PX,
      );
    }
  });

  it('adds no publishes of its own across a full zoom-out ramp', () => {
    // Every band edge it has is also a `patternCutoff` step, so the page is
    // never re-rendered for this value alone. A ramp that published more after
    // it was added would be paying a full re-render per octave for it.
    let zoom = 1;
    const before = new Set<string>();
    const after = new Set<string>();
    for (let i = 0; i < 160; i++) {
      zoom *= 0.05 ** (1 / 160);
      const detail = zoom >= 0.35 ? 'high' : 'low';
      const dots = zoom < 0.2 ? 9 : 0;
      before.add(`${patternCutoff(zoom)}|${detail}|${dots}`);
      after.add(
        `${patternCutoff(zoom)}|${detail}|${dots}|${inkErrorLimit(zoom)}`,
      );
    }
    expect(after.size).toBe(before.size);
  });
});

// The whole-shape counterpart to `patternCutoff`: below this footprint a shape
// covers too few pixels for its silhouette to read, and a box of the same
// weight is indistinguishable from its geometry.
describe('impostorCutoff', () => {
  it('paints every shape as itself until the page pulls back', () => {
    expect(impostorCutoff(2)).toBe(0);
    expect(impostorCutoff(1)).toBe(0);
    expect(impostorCutoff(0.5)).toBe(0);
  });

  it('rises as the camera pulls out, one value per zoom octave', () => {
    expect(impostorCutoff(0.26)).toBe(impostorCutoff(0.49));
    expect(impostorCutoff(0.13)).toBe(impostorCutoff(0.25));
    expect(impostorCutoff(0.25)).toBeCloseTo(2 * impostorCutoff(0.49), 10);
  });

  // Conservative in the same direction `inkErrorLimit` is: the band's upper
  // zoom edge sets the cutoff, so a shape is impostored once it is comfortably
  // under the screen budget rather than the moment it crosses it.
  it('never impostors a shape bigger on screen than the budget', () => {
    for (let zoom = 0.02; zoom < 0.5; zoom += 0.005) {
      expect(impostorCutoff(zoom) * zoom).toBeLessThanOrEqual(4);
    }
  });

  it('impostors a stroke only once it is a smudge', () => {
    // At zoom 0.4 the cutoff is 8 world units, so a 12-unit scribble — 4.8 CSS
    // px, still a shape — keeps its geometry, and a 6-unit one — 2.4 px, a
    // smudge — becomes a box.
    expect(12 > impostorCutoff(0.4)).toBe(true);
    expect(6 <= impostorCutoff(0.4)).toBe(true);
  });

  it('adds no publishes of its own across a full zoom-out ramp', () => {
    // It shares `inkErrorLimit`'s octave edges exactly, so every value it
    // changes at is already a publish. A ramp that published more after it was
    // added would be paying a full re-render per octave for it.
    let zoom = 1;
    const before = new Set<string>();
    const after = new Set<string>();
    for (let i = 0; i < 160; i++) {
      zoom *= 0.05 ** (1 / 160);
      const shared = `${patternCutoff(zoom)}|${inkErrorLimit(zoom)}`;
      before.add(shared);
      after.add(`${shared}|${impostorCutoff(zoom)}`);
    }
    expect(after.size).toBe(before.size);
  });
});

describe('imageThumbCutoff', () => {
  it('draws originals at and above the pattern threshold, and in export', () => {
    expect(imageThumbCutoff(1)).toBe(0);
    expect(imageThumbCutoff(0.5)).toBe(0);
  });

  it('never lets a thumbnail exceed 256 CSS px on screen', () => {
    for (let z = 0.49; z > 0.01; z *= 0.93)
      expect(imageThumbCutoff(z) * z).toBeLessThanOrEqual(256);
  });

  it('adds no publishes of its own across a full zoom-out ramp', () => {
    let zoom = 1;
    const before = new Set<string>();
    const after = new Set<string>();
    for (let i = 0; i < 160; i++) {
      zoom *= 0.05 ** (1 / 160);
      const shared = `${patternCutoff(zoom)}|${inkErrorLimit(zoom)}|${impostorCutoff(zoom)}`;
      before.add(shared);
      after.add(`${shared}|${imageThumbCutoff(zoom)}`);
    }
    expect(after.size).toBe(before.size);
  });
});
