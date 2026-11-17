import { describe, expect, it } from 'vitest';
import { exactPi } from './graph-ticks';

describe('exactPi', () => {
  it('names multiples of π/4 and nothing else', () => {
    expect(exactPi(-Math.PI / 2)).toBe('−π/2');
    expect(exactPi((-5 * Math.PI) / 2)).toBe('−5π/2');
    expect(exactPi(Math.PI / 4)).toBe('π/4');
    expect(exactPi(1.02)).toBeNull();
    expect(exactPi(1.57)).toBeNull();
    expect(exactPi(0)).toBeNull();
  });
});
