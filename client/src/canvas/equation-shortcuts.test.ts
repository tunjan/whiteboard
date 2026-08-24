import { describe, expect, it } from 'vitest';
import {
  editReplacement,
  enclosingEnvironment,
  environmentNewline,
  openBracket,
  skipClosingBracket,
  tabEdit,
} from './equation-shortcuts';

describe('typing a bracket', () => {
  it('closes it and sits between the pair', () => {
    expect(openBracket('x + ', 4, 4, '(')).toEqual({
      value: 'x + ()',
      caret: 5,
    });
  });

  it('wraps the selection instead', () => {
    expect(openBracket('a+b', 0, 3, '(')).toEqual({ value: '(a+b)', caret: 5 });
  });

  it('leaves an expression alone when text follows the caret', () => {
    expect(openBracket('x+1', 0, 0, '(')).toBeNull();
  });

  it('steps over a closing bracket already there', () => {
    expect(skipClosingBracket('(x)', 2, 2, ')')).toEqual({
      value: '(x)',
      caret: 3,
    });
    expect(skipClosingBracket('(x', 2, 2, ')')).toBeNull();
  });
});

describe('environments', () => {
  it('names the innermost open environment', () => {
    const source = '\\begin{aligned} x &= \\begin{cases} a';
    expect(enclosingEnvironment(source, source.length)).toBe('cases');
    expect(enclosingEnvironment('x = 1', 5)).toBeNull();
  });

  it('ends a row with a line break on Enter', () => {
    const source = '\\begin{aligned}\n  x &= 1';
    expect(environmentNewline(source, source.length)?.value).toBe(
      '\\begin{aligned}\n  x &= 1 \\\\\n  ',
    );
  });

  it('leaves Enter alone outside a row environment', () => {
    expect(environmentNewline('x = 1', 5)).toBeNull();
  });

  it('sends Tab to the next empty slot', () => {
    const source = '\\frac{a}{}';
    expect(tabEdit(source, 7)).toEqual({ value: source, caret: 9 });
  });

  it('sends Tab to the next matrix cell once the slots are filled', () => {
    const source = '\\begin{pmatrix}\n  a';
    expect(tabEdit(source, source.length)?.value).toBe(
      '\\begin{pmatrix}\n  a & ',
    );
  });

  it('lets Tab leave the field when it has nothing to do', () => {
    expect(tabEdit('x = 1', 5)).toBeNull();
  });
});

// The panel writes a rule's rewrite into the field as this replacement rather
// than as a whole value, so the browser records it as one undoable edit.
describe('reducing a rewrite to the edit it is', () => {
  it('finds a wrapped selection in the middle of the source', () => {
    expect(editReplacement('x + a+b + 1', 'x + (a+b) + 1')).toEqual({
      start: 4,
      end: 7,
      text: '(a+b)',
    });
  });

  it('finds a pure insertion', () => {
    expect(editReplacement('ab', 'aXb')).toEqual({
      start: 1,
      end: 1,
      text: 'X',
    });
  });

  it('finds a pure deletion', () => {
    expect(editReplacement('x^2} + 1', 'x^2 + 1')).toEqual({
      start: 3,
      end: 4,
      text: '',
    });
  });

  it('reports nothing to write when a rule only moved the caret', () => {
    expect(editReplacement('\\frac{}{}', '\\frac{}{}')).toBeNull();
  });

  // A repeated character either side of the change must not be double-counted,
  // or the replacement would eat a brace the user still needs.
  it('keeps the edit inside the run of repeated characters', () => {
    expect(editReplacement('{{a}', '{{a}}')).toEqual({
      start: 4,
      end: 4,
      text: '}',
    });
  });
});
