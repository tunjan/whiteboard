import { describe, expect, it } from 'vitest';
import { formatBound, parseBound } from './graph-panel-utils';

describe('range bounds', () => {
  it('writes π multiples, a true minus and span-sized precision', () => {
    expect(formatBound(2 * Math.PI)).toBe('2π');
    expect(formatBound(-Math.PI / 2)).toBe('−π/2');
    expect(formatBound(3 * Math.PI / 4)).toBe('3π/4');
    expect(formatBound(6.283)).toBe('2π'); // boards saved before exact presets
    expect(formatBound(3.14)).toBe('3.14');
    expect(formatBound(-10, 20)).toBe('−10');
    expect(formatBound(1.23456, 0.01)).toBe('1.2346');
    expect(formatBound(0)).toBe('0');
  });

  it('reads what it writes and what people type', () => {
    expect(parseBound('2π')).toBeCloseTo(2 * Math.PI);
    expect(parseBound('−π/2')).toBeCloseTo(-Math.PI / 2);
    expect(parseBound('-3pi/4')).toBeCloseTo(-3 * Math.PI / 4);
    expect(parseBound('2 * pi')).toBeCloseTo(2 * Math.PI);
    expect(parseBound('6,28')).toBe(6.28);
    expect(parseBound('−10')).toBe(-10);
    expect(parseBound('')).toBeNaN();
    expect(parseBound('abc')).toBeNaN();
    expect(parseBound('.π')).toBeNaN();
  });
});
