import { describe, expect, it } from 'vitest';
import { consumeEquationFocus, requestEquationFocus } from './equation-focus';

describe('equation focus hand-off', () => {
  it('grants focus once, to the shape that asked for it', () => {
    requestEquationFocus('eq-1');

    expect(consumeEquationFocus('eq-1')).toBe(true);
    // A re-mount of the same panel must not steal focus a second time.
    expect(consumeEquationFocus('eq-1')).toBe(false);
  });

  it('denies focus to an equation that was merely selected', () => {
    requestEquationFocus('eq-1');

    expect(consumeEquationFocus('eq-2')).toBe(false);
    // The pending request survives an unrelated selection.
    expect(consumeEquationFocus('eq-1')).toBe(true);
  });

  it('denies focus when nothing was placed', () => {
    consumeEquationFocus('eq-1');

    expect(consumeEquationFocus('eq-1')).toBe(false);
  });
});
