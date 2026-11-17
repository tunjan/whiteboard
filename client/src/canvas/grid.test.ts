import { describe, expect, it } from 'vitest';
import {
  DOT_GRID_REST_PX,
  getDotGridLayers,
  getSnapGridStep,
  pmod,
  triangleTile,
} from './grid';

describe('dot grid overdraw', () => {
  it.each([
    [0.05, [512, 128]],
    [0.375, [128, 32]],
    [1, [32, 8]],
    [2.5, [32, 8]],
    [8, [8]],
  ])(
    'keeps only the finest opaque layer and fading detail at zoom %s',
    (z, steps) => {
      const visible = getDotGridLayers({ x: 0, y: 0, z: z as number }).filter(
        (l) => l.opacity > 0.01,
      );
      expect(visible.map((l) => l.step)).toEqual(steps);
    },
  );

  it('preserves the finer fade across an opaque threshold', () => {
    const before = getDotGridLayers({ x: 0, y: 0, z: 1 - 1e-6 });
    const after = getDotGridLayers({ x: 0, y: 0, z: 1 });
    expect(before.map((l) => l.step)).toEqual([128, 32, 8]);
    expect(after.map((l) => l.step)).toEqual([32, 8]);
    expect(after[1]!.opacity).toBeCloseTo(before[2]!.opacity);
  });

  it('holds dense dots at a lighter minor shade before they take over', () => {
    // The 8-unit lattice: 6px apart at z=0.75, 20px at z=2.5, 32px at z=4.
    const at = (z: number) =>
      getDotGridLayers({ x: 0, y: 0, z }).find((l) => l.step === 8)?.opacity ??
      1;
    expect(at(0.75)).toBeCloseTo(0);
    expect(at(2.5)).toBeCloseTo(0.35);
    expect(at(4)).toBe(1);
    // At the default zoom the minor dots stay well under the major ones.
    expect(at(1)).toBeLessThan(0.1);
  });

  it('never changes a layer opacity in a jump while zooming', () => {
    let prev = new Map<string, number>();
    for (let z = 0.05; z <= 8; z *= 1.001) {
      const next = new Map(
        getDotGridLayers({ x: 0, y: 0, z }).map((l) => [l.id, l.opacity]),
      );
      for (const [id, opacity] of next) {
        const was = prev.get(id);
        if (was !== undefined)
          expect(Math.abs(opacity - was)).toBeLessThan(0.01);
      }
      prev = next;
    }
  });

  it('preserves world phase at negative and distant camera positions', () => {
    for (const ratio of [1, 2]) {
      for (const x of [-100001.25, -0.5, 0, 98765.125]) {
        for (const z of [0.05, 0.375, 1, 2.5, 8]) {
          for (const layer of getDotGridLayers({ x, y: -x, z }, ratio)) {
            expect(layer.offsetX).toBeCloseTo(
              pmod(Math.round(-x * z * ratio) / ratio, layer.screenStep),
            );
            expect(layer.offsetY).toBeCloseTo(
              pmod(Math.round(x * z * ratio) / ratio, layer.screenStep),
            );
          }
        }
      }
    }
  });

  it('lands dots on device-pixel corners at whole-step zooms', () => {
    for (const ratio of [1, 2]) {
      for (const layer of getDotGridLayers(
        { x: 3.37, y: -11.9, z: 1 },
        ratio,
      )) {
        expect((layer.offsetX * ratio) % 1).toBeCloseTo(0);
        expect((layer.offsetY * ratio) % 1).toBeCloseTo(0);
      }
    }
  });

  it('exports the lattice the board rests on at zoom 1', () => {
    expect(DOT_GRID_REST_PX).toBe(32);
  });
});

describe('dot grid snapping', () => {
  it.each([
    [0.05, 512],
    [0.375, 128],
    [1, 32],
    [2, 32],
    [3, 8],
    [8, 8],
  ])('snaps to the finest clearly visible lattice at zoom %s', (z, step) => {
    expect(getSnapGridStep('dot', { x: 0, y: 0, z: z as number })).toBe(step);
  });
});

describe('triangle grid tile', () => {
  it.each(['isometric', 'triangle'] as const)(
    '%s: all three rule families are equilateral and step apart',
    (type) => {
      const { w, h, lines } = triangleTile(type, 10);
      // Copy one tile along the rules: the nearest parallel line.
      const shift = type === 'isometric' ? [0, h] : [w, 0];
      for (const [x1, y1, x2, y2] of lines.slice(-2)) {
        const len = Math.hypot(x2! - x1!, y2! - y1!);
        const [ux, uy] = [(x2! - x1!) / len, (y2! - y1!) / len];
        const along = type === 'isometric' ? Math.abs(uy) : Math.abs(ux);
        expect(along).toBeCloseTo(Math.cos(Math.PI / 3));
        expect(Math.abs(shift[0]! * -uy + shift[1]! * ux)).toBeCloseTo(10);
      }
    },
  );
});
