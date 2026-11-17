import { describe, expect, it } from 'vitest';
import { autoEquationTag } from './equation-number';

describe('auto-numbering a new equation', () => {
  it('starts at 1 and continues past the highest number', () => {
    expect(autoEquationTag(undefined, [])).toBe('1');
    expect(autoEquationTag(undefined, ['1', '4', 'Pythagoras', '', undefined])).toBe('5');
  });

  it('renumbers a duplicate but keeps a number that is still free', () => {
    expect(autoEquationTag('2', ['1', '2'])).toBe('3');
    expect(autoEquationTag('7', ['1', '2'])).toBe('7');
  });

  it('leaves a removed number and a name alone', () => {
    expect(autoEquationTag('', ['1'])).toBe('');
    expect(autoEquationTag('Pythagoras', ['Pythagoras'])).toBe('Pythagoras');
  });
});
