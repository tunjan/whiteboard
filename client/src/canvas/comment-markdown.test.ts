import { describe, expect, it } from 'vitest';
import {
  parseCommentMarkdown,
  parseInline,
  type InlineNode,
} from './comment-markdown';

/** Flatten to the plain text a reader would see, marks included. */
function textOf(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.value;
        case 'code':
          return node.value;
        case 'math':
          return `[math:${node.latex}]`;
        default:
          return textOf(node.children);
      }
    })
    .join('');
}

describe('parseInline', () => {
  it('parses the marks a comment actually mixes', () => {
    const nodes = parseInline(
      '**Question 4(a)**: you wrote $(x+1)$ instead of $(x-1)$[cite: 1].',
    );
    expect(nodes).toEqual([
      { type: 'strong', children: [{ type: 'text', value: 'Question 4(a)' }] },
      { type: 'text', value: ': you wrote ' },
      { type: 'math', latex: '(x+1)', display: false },
      { type: 'text', value: ' instead of ' },
      { type: 'math', latex: '(x-1)', display: false },
      { type: 'text', value: '[cite: 1].' },
    ]);
  });

  it('keeps math source verbatim, marks and all', () => {
    expect(parseInline('$a_1 \\times b^*$')).toEqual([
      { type: 'math', latex: 'a_1 \\times b^*', display: false },
    ]);
  });

  it('reads $$…$$ and \\[…\\] as display style, \\(…\\) as inline', () => {
    expect(parseInline('$$x^2$$')).toEqual([
      { type: 'math', latex: 'x^2', display: true },
    ]);
    expect(parseInline('\\[x^2\\]')).toEqual([
      { type: 'math', latex: 'x^2', display: true },
    ]);
    expect(parseInline('\\(x^2\\)')).toEqual([
      { type: 'math', latex: 'x^2', display: false },
    ]);
  });

  it('leaves prices and unclosed delimiters as typed', () => {
    expect(textOf(parseInline('it costs $5, or $8 abroad'))).toBe(
      'it costs $5, or $8 abroad',
    );
    expect(textOf(parseInline('half an equation $x = '))).toBe(
      'half an equation $x = ',
    );
    expect(parseInline('2 * 3 * 4')).toEqual([
      { type: 'text', value: '2 * 3 * 4' },
    ]);
  });

  it('does not italicize an underscore inside a word', () => {
    expect(parseInline('n_max and n_min')).toEqual([
      { type: 'text', value: 'n_max and n_min' },
    ]);
  });

  it('honours backslash escapes outside math', () => {
    expect(parseInline('\\$5 and \\*not bold\\*')).toEqual([
      { type: 'text', value: '$5 and *not bold*' },
    ]);
  });

  it('takes code spans verbatim', () => {
    expect(parseInline('use `$x$` for math')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: '$x$' },
      { type: 'text', value: ' for math' },
    ]);
  });

  it('links only to schemes it can trust', () => {
    expect(parseInline('[docs](https://example.com)')).toEqual([
      {
        type: 'link',
        href: 'https://example.com',
        children: [{ type: 'text', value: 'docs' }],
      },
    ]);
    expect(textOf(parseInline('[ok](javascript:alert(1))'))).toBe(
      '[ok](javascript:alert(1))',
    );
  });

  it('nests marks, including math inside emphasis', () => {
    expect(parseInline('**check $x^2$**')).toEqual([
      {
        type: 'strong',
        children: [
          { type: 'text', value: 'check ' },
          { type: 'math', latex: 'x^2', display: false },
        ],
      },
    ]);
  });
});

describe('parseCommentMarkdown', () => {
  it('splits paragraphs on blank lines and keeps single breaks', () => {
    const blocks = parseCommentMarkdown('one\ntwo\n\nthree');
    expect(blocks).toHaveLength(2);
    expect(textOf((blocks[0] as { children: InlineNode[] }).children)).toBe(
      'one\ntwo',
    );
  });

  it('reads headings and both kinds of list', () => {
    const blocks = parseCommentMarkdown(
      '## Marking\n\n- first\n- second\n\n4. step four\n5. step five',
    );
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2 });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false, start: 1 });
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: true, start: 4 });
    expect((blocks[2] as { items: InlineNode[][] }).items).toHaveLength(2);
  });

  it('does not mistake a bold line for a bullet', () => {
    const blocks = parseCommentMarkdown('**bold**');
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(textOf((blocks[0] as { children: InlineNode[] }).children)).toBe(
      'bold',
    );
  });
});
