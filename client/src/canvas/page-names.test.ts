import { describe, expect, it } from 'vitest';
import { getIncrementedName } from './page-names';

describe('getIncrementedName', () => {
  it('returns the name unchanged when it is free', () => {
    expect(getIncrementedName('Page 1', ['Page 2'])).toBe('Page 1');
  });

  it('appends a counter to a name with no numeric suffix', () => {
    expect(getIncrementedName('Notes', ['Notes'])).toBe('Notes 1');
  });

  it('increments an existing bare suffix instead of stacking one', () => {
    expect(getIncrementedName('Notes 2', ['Notes 2'])).toBe('Notes 3');
  });

  it('preserves parenthesized suffixes', () => {
    expect(getIncrementedName('Notes (2)', ['Notes (2)'])).toBe('Notes (3)');
  });

  it('walks past a run of taken names', () => {
    expect(getIncrementedName('Page 1', ['Page 1', 'Page 2', 'Page 3'])).toBe(
      'Page 4',
    );
  });

  it('skips gaps rather than reusing a freed number', () => {
    expect(getIncrementedName('Notes', ['Notes', 'Notes 1', 'Notes 3'])).toBe(
      'Notes 2',
    );
  });

  it('treats a trailing number as part of the stem when not separated', () => {
    expect(getIncrementedName('Chapter7', ['Chapter7'])).toBe('Chapter7 1');
  });

  it('handles a name that is only a number', () => {
    expect(getIncrementedName('2', ['2'])).toBe('2 1');
  });
});
