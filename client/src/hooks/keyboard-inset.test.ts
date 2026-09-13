import { describe, expect, it } from 'vitest';
import { keyboardInset } from './keyboard-inset';

describe('keyboardInset', () => {
  it('is zero with no keyboard up', () => {
    expect(
      keyboardInset({ layoutHeight: 1024, visualHeight: 1024, offsetTop: 0 }),
    ).toBe(0);
  });

  it('ignores the few pixels a collapsing browser bar moves', () => {
    expect(
      keyboardInset({ layoutHeight: 1024, visualHeight: 980, offsetTop: 0 }),
    ).toBe(0);
  });

  it('reports the covered strip', () => {
    expect(
      keyboardInset({ layoutHeight: 1024, visualHeight: 690, offsetTop: 0 }),
    ).toBe(334);
  });

  it('counts the scroll Safari applied to reveal the focused field', () => {
    expect(
      keyboardInset({ layoutHeight: 1024, visualHeight: 690, offsetTop: 100 }),
    ).toBe(234);
  });
});
