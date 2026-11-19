import { beforeAll, describe, expect, it } from 'vitest';
import { convertEquation, ensureConverter } from './equation-convert';

/** The rule's `x` and the surd's advance (where MathJax starts the rule). */
function ruleStart(latex: string): number {
  const render = convertEquation(latex);
  if (!render.svg) throw new Error(render.error);
  // The radical's rule is the rect right after the surd; a fraction inside
  // has its own bar earlier on.
  return Number(/data-c="221A"[\s\S]*?<rect[^>]* x="([\d.-]+)"|data-c="E001"[\s\S]*?<rect[^>]* x="([\d.-]+)"/.exec(render.svg)!.slice(1).find(Boolean));
}

describe('radicals', () => {
  beforeAll(() => ensureConverter());

  it('pulls the rule back over each fixed-size surd so the join has no notch', () => {
    // MathJax puts the rule exactly at the glyph's advance: 853 for the
    // smallest surd, 1020 for the larger fixed sizes.
    expect(ruleStart('\\sqrt{x}')).toBe(833);
    expect(ruleStart('\\sqrt{x^2+1}')).toBe(1000);
    expect(ruleStart('\\sqrt{\\frac{a}{b}}')).toBe(1000);
  });

  it('leaves the stretched surd, whose arm already runs into the rule', () => {
    expect(ruleStart('\\sqrt{\\frac{\\frac{\\frac{a}{b}}{c}}{\\frac{d}{e}}}')).toBe(1056);
  });
});
