import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CommentText } from './CommentText';
import { typesetEquation } from './equation-render';

const EXAMPLE =
  '**Question 4(a)**: You miscopied the original problem as $(x+1)$ instead of $(x-1)$[cite: 1], and had a sign error inside the discriminant of the quadratic formula ($-4ac$ gives $+88$, not $-88$).';

describe('CommentText', () => {
  it('renders marks as elements and leaves nothing in delimiters', async () => {
    // Fill the render cache first: the component reads it synchronously and
    // shows the source itself until an expression is typeset.
    for (const latex of ['(x+1)', '(x-1)', '-4ac', '+88', '-88']) {
      await typesetEquation(latex, true);
    }
    const html = renderToStaticMarkup(<CommentText text={EXAMPLE} />);

    expect(html).toContain(
      '<strong class="font-semibold">Question 4(a)</strong>',
    );
    expect(html).toContain('aria-label="Equation: (x-1)"');
    // Sized in em, so math scales with the comment's text.
    expect(html).toMatch(/width:\s*[\d.]+em/);
    expect(html.match(/<svg/g)).toHaveLength(5);
    // No delimiter survives into the output.
    expect(html).not.toContain('$');
    expect(html).not.toContain('**');
    // …but text that only looks like a mark does.
    expect(html).toContain('[cite: 1]');
  });

  it('shows the source of an expression that cannot be typeset', async () => {
    await typesetEquation('\\notacommand', true);
    const html = renderToStaticMarkup(
      <CommentText text={'see $\\notacommand$'} />,
    );
    expect(html).toContain('text-danger');
    expect(html).toContain('\\notacommand');
  });
});
