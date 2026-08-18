import { describe, expect, it } from 'vitest';
import { InputsManager, isPenOrStylus } from './inputs-manager';

describe('InputsManager', () => {
  it('uses the exact 16 ms frame-normalized EMA weight', () => {
    const inputs = new InputsManager();
    inputs.reset({ x: 0, y: 0 }, 0);

    expect(inputs.update({ x: 16, y: 0 }, 16)).toEqual({ x: 0.5, y: 0 });
    expect(inputs.update({ x: 32, y: 0 }, 32)).toEqual({ x: 0.75, y: 0 });
  });

  it('converges identically over equal time at different report rates', () => {
    const run = (stepMs: number) => {
      const inputs = new InputsManager();
      inputs.reset({ x: 0, y: 0 }, 0);
      let velocity = { x: 0, y: 0 };
      for (let time = stepMs; time <= 64; time += stepMs) {
        velocity = inputs.update({ x: time, y: 0 }, time);
      }
      return velocity;
    };

    expect(run(16).x).toBeCloseTo(run(4).x, 12);
    expect(run(16).x).toBeCloseTo(1 - 0.5 ** 4, 12);
  });

  it('decays a stopped pointer and snaps sub-threshold velocity to zero', () => {
    const inputs = new InputsManager();
    inputs.reset({ x: 0, y: 0 }, 0);
    inputs.update({ x: 16, y: 0 }, 16);

    expect(inputs.update({ x: 16, y: 0 }, 128)).toEqual({ x: 0, y: 0 });
  });
});

describe('isPenOrStylus', () => {
  it('accepts explicit pens and non-neutral pressure evidence', () => {
    expect(isPenOrStylus('pen', 0.5)).toBe(true);
    expect(isPenOrStylus('touch', 0.2)).toBe(true);
    expect(isPenOrStylus('mouse', 0.8)).toBe(true);
  });

  it('keeps neutral and contact-edge standard pointers out', () => {
    expect(isPenOrStylus('mouse', 0)).toBe(false);
    expect(isPenOrStylus('mouse', 0.5)).toBe(false);
    expect(isPenOrStylus('touch', 1)).toBe(false);
  });
});
