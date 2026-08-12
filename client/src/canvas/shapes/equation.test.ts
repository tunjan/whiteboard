import { describe, expect, it } from 'vitest';
import type { EquationRender } from '../equation-render';
import { equationDisplay } from './equation';

const typeset: Extract<EquationRender, { svg: string }> = {
  svg: '<svg />',
  width: 40,
  height: 20,
};
const failed: EquationRender = { error: 'Undefined control sequence: \\fra' };

describe('what an equation shape draws', () => {
  it('draws the placeholder for an equation with no source', () => {
    expect(equationDisplay('', undefined, null, true)).toEqual({
      kind: 'empty',
    });
  });

  it('draws the typeset expression once it is in the cache', () => {
    expect(equationDisplay('x^2', typeset, null, true)).toEqual({
      kind: 'typeset',
      render: typeset,
    });
  });

  it('waits rather than erroring while a conversion is in flight', () => {
    expect(equationDisplay('x^2', undefined, null, true)).toEqual({
      kind: 'loading',
    });
  });

  it('keeps the last typeset expression while a half-typed source fails', () => {
    expect(equationDisplay('\\fra', failed, typeset, false)).toEqual({
      kind: 'typeset',
      render: typeset,
    });
  });

  it('falls back to the neutral box when nothing has typeset yet', () => {
    expect(equationDisplay('\\fra', failed, null, false)).toEqual({
      kind: 'loading',
    });
  });

  it('shows the error once the source stops changing', () => {
    expect(equationDisplay('\\fra', failed, typeset, true)).toEqual({
      kind: 'error',
    });
    expect(equationDisplay('\\fra', failed, null, true)).toEqual({
      kind: 'error',
    });
  });
});
