import { describe, expect, it } from 'vitest';
import type { TextProps } from '@whiteboard/shared';
import { layoutTextProps } from './text-measure';
import {
  isRichText,
  richTextLayout,
  textBoxSize,
  type RichTextItem,
  type RichTextLayout,
} from './text-rich';

const props = (text: string, extra: Partial<TextProps> = {}): TextProps => ({
  text,
  color: '#000',
  fontSize: 20,
  fontFamily: 'sans',
  width: 0,
  align: 'start',
  ...extra,
});

const layout = (text: string, extra?: Partial<TextProps>): RichTextLayout =>
  richTextLayout(props(text, extra))!;

const texts = (items: RichTextItem[]) =>
  items.flatMap((item) => (item.kind === 'text' ? [item] : []));

describe('isRichText', () => {
  it('keeps unmarked text on the line-layout path', () => {
    expect(isRichText('hello world')).toBe(false);
    expect(isRichText('two\n\nparagraphs')).toBe(false);
    expect(isRichText('#1 priority')).toBe(false);
    // A lone dollar is a price, not math.
    expect(isRichText('it costs $5, or $8 abroad')).toBe(false);
    // An unsafe link scheme is not a link, so it stays literal.
    expect(isRichText('[site](javascript:alert(1))')).toBe(false);
  });

  it('detects Markdown marks and math', () => {
    expect(isRichText('**bold**')).toBe(true);
    expect(isRichText('# Title')).toBe(true);
    expect(isRichText('- one\n- two')).toBe(true);
    expect(isRichText('[site](https://example.com)')).toBe(true);
    expect(isRichText('area $\\pi r^2$')).toBe(true);
    expect(isRichText('$$\\int_0^1 x\\,dx$$')).toBe(true);
  });

  it('treats an escape as a mark so it renders unescaped', () => {
    expect(isRichText('\\$5')).toBe(true);
    expect(texts(layout('\\$5').items).map((item) => item.text)).toEqual(['$5']);
  });
});

describe('richTextLayout', () => {
  it('draws untypeset math as its source and reports it pending', () => {
    const result = layout('inline $x^2$ and $$y_1$$');
    expect(texts(result.items).map((item) => item.text)).toContain('x^2');
    expect(result.items.some((item) => item.kind === 'code')).toBe(true);
    expect(result.pendingMath).toEqual([
      { latex: 'x^2', display: false },
      { latex: 'y_1', display: true },
    ]);
  });

  it('merges words in one font into a single run', () => {
    const items = texts(layout('one two **three** four').items);
    expect(items.map((item) => item.text)).toEqual(['one two ', 'three', ' four']);
    expect(items[1]!.weight).toBe(700);
  });

  it('wraps at the fixed width, and only there', () => {
    const text = 'some **bold** words that will not fit on one line';
    const wrapped = layout(text, { sizingMode: 'fixed', width: 120 });
    const baselines = new Set(texts(wrapped.items).map((item) => item.y));
    expect(wrapped.width).toBe(120);
    expect(baselines.size).toBeGreaterThan(1);
    for (const item of texts(wrapped.items)) {
      expect(item.text.startsWith(' ')).toBe(false);
    }

    const auto = layout(text);
    expect(new Set(texts(auto.items).map((item) => item.y)).size).toBe(1);
    expect(auto.width).toBeGreaterThan(120);
  });

  it('marks list items and keeps the ordered start', () => {
    const bullets = texts(layout('- a\n- b').items).filter((item) => item.text === '•');
    expect(bullets).toHaveLength(2);
    expect(texts(layout('3. c\n4. d').items).map((item) => item.text)).toEqual(
      expect.arrayContaining(['3.', '4.']),
    );
  });

  it('sets headings larger and bold, and stacks blocks downward', () => {
    const [heading, body] = texts(layout('# Title\nbody *text*').items);
    expect(heading!.size).toBeGreaterThan(body!.size);
    expect(heading!.weight).toBe(700);
    expect(body!.y).toBeGreaterThan(heading!.y);
  });

  it('underlines links and strikes through deletions', () => {
    const rules = (text: string) =>
      layout(text).items.filter((item) => item.kind === 'rule');
    expect(rules('[site](https://example.com)')).toHaveLength(1);
    expect(rules('~~gone~~')).toHaveLength(1);
  });
});

describe('textBoxSize', () => {
  it('is the line layout for plain text', () => {
    const p = props('plain');
    expect(richTextLayout(p)).toBeNull();
    const plain = layoutTextProps(p);
    expect(textBoxSize(p)).toMatchObject({ width: plain.width, height: plain.height });
  });

  it('is the rich layout for marked text', () => {
    const p = props('# Big\n\n- item');
    const rich = richTextLayout(p)!;
    expect(textBoxSize(p)).toMatchObject({ width: rich.width, height: rich.height });
    expect(rich.height).toBeGreaterThan(layoutTextProps(props('x')).height * 2);
  });
});
