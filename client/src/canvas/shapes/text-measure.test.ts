import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MIN_TEXT_WIDTH,
  caretForTextIndex,
  layoutText,
  layoutTextProps,
  resolveLineHeightPx,
  stabilizeTextPosition,
  textAlignOffset,
  textIndexAtPoint,
  textSelectionRects,
} from './text-measure';

/**
 * Load a fresh copy of the module against a stub 2D context whose advance width
 * scales with the weight in `ctx.font`. Tests run in Node, where the real
 * measurer is absent and the fallback ignores weight entirely, so this is what
 * makes weight-sensitive measurement observable.
 */
async function importWithStubCanvas() {
  const ctx = {
    font: '',
    measureText(text: string) {
      const weight = Number.parseInt(this.font, 10) || 400;
      const size = Number.parseFloat(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? '10');
      return { width: text.length * size * 0.6 * (weight / 400) };
    },
  };
  vi.stubGlobal('document', {
    createElement: () => ({ getContext: () => ctx }),
  });
  vi.resetModules();
  return import('./text-measure');
}


describe('text layout', () => {
  it('keeps auto-sized paragraphs unwrapped except at explicit newlines', () => {
    const layout = layoutText({
      text: 'alpha beta\ngamma',
      fontSize: 10,
      sizingMode: 'auto',
    });

    expect(layout.lines.map((line) => line.text)).toEqual([
      'alpha beta',
      'gamma',
    ]);
    expect(layout.lines[0]?.hardBreak).toBe(true);
    expect(layout.height).toBeCloseTo(24);
  });

  it('wraps fixed-width text at whitespace and splits oversized words', () => {
    const words = layoutText({
      text: 'one two',
      fontSize: 10,
      sizingMode: 'fixed',
      width: 24,
    });
    expect(words.lines.map((line) => line.text)).toEqual(['one ', 'two']);
    expect(words.width).toBe(24);

    const oversized = layoutText({
      text: 'abcdef',
      fontSize: 10,
      sizingMode: 'fixed',
      width: 18,
    });
    expect(oversized.lines.map((line) => line.text)).toEqual(['abc', 'def']);
  });

  it('maps local pointer positions and string offsets through wrapped lines', () => {
    const layout = layoutText({
      text: 'abcd',
      fontSize: 10,
      sizingMode: 'fixed',
      width: 12,
    });

    expect(layout.lines.map((line) => line.text)).toEqual(['ab', 'cd']);
    expect(textIndexAtPoint(layout, { x: 8, y: 1 })).toBe(1);
    expect(textIndexAtPoint(layout, { x: 1, y: 13 })).toBe(2);

    const caret = caretForTextIndex(layout, 2);
    expect(caret.y).toBeCloseTo(12);
    expect(caret.x).toBe(0);
  });

  it('produces one local selection rectangle per intersected line', () => {
    const layout = layoutText({
      text: 'abcd',
      fontSize: 10,
      sizingMode: 'fixed',
      width: 12,
    });
    const rects = textSelectionRects(layout, 1, 3);

    expect(rects).toHaveLength(2);
    expect(rects[0]?.width).toBeCloseTo(6);
    expect(rects[1]?.width).toBeCloseTo(6);
  });
});

describe('font weight', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('defaults to 400 and carries an explicit weight into the layout', () => {
    expect(layoutText({ text: 'a', fontSize: 10 }).fontWeight).toBe(400);
    expect(
      layoutText({ text: 'a', fontSize: 10, fontWeight: 700 }).fontWeight,
    ).toBe(700);
  });

  it('measures each weight separately rather than reusing a cached width', async () => {
    const { measureTextWidth } = await importWithStubCanvas();

    // Same text and size, so a key that omits weight would serve the 400 width
    // to every later call and silently mis-wrap every non-default weight.
    const regular = measureTextWidth('abc', 10, 'sans', 400);
    const bold = measureTextWidth('abc', 10, 'sans', 700);

    expect(regular).toBeCloseTo(18);
    expect(bold).toBeCloseTo(31.5);
    expect(measureTextWidth('abc', 10, 'sans', 400)).toBeCloseTo(regular);
  });

  it('wraps a bolder weight sooner, since its glyphs advance wider', async () => {
    const { layoutText: layout } = await importWithStubCanvas();
    const opts = { text: 'aaaa', fontSize: 10, sizingMode: 'fixed' as const, width: 24 };

    expect(layout({ ...opts, fontWeight: 400 }).lines.map((l) => l.text)).toEqual([
      'aaaa',
    ]);
    expect(layout({ ...opts, fontWeight: 700 }).lines.map((l) => l.text)).toEqual([
      'aa',
      'aa',
    ]);
  });
});

describe('line height quantization', () => {
  it('rounds the line advance to whole pixels', () => {
    // 10 * 1.15 = 11.5 exactly, which the two layout engines would round in
    // opposite directions if it were left fractional.
    expect(resolveLineHeightPx(10, 1.15)).toBe(12);
    expect(resolveLineHeightPx(24, 1.2)).toBe(29);
    expect(resolveLineHeightPx(10, 0.01)).toBe(1);
  });

  it('lays lines out on the quantized advance', () => {
    const layout = layoutText({
      text: 'a\nb\nc',
      fontSize: 24,
      lineHeight: 1.2,
      sizingMode: 'auto',
    });
    expect(layout.lineHeight).toBe(29);
    expect(layout.lines.map((line) => line.y)).toEqual([0, 29, 58]);
    expect(layout.height).toBe(87);
  });
});

describe('auto-size width', () => {
  it('pads the measured advance so trailing ink is not shaved off', async () => {
    const { layoutText: layout } = await importWithStubCanvas();
    // Stub advance: 3 chars * 10px * 0.6 = 18.
    expect(layout({ text: 'abc', fontSize: 10, sizingMode: 'auto' }).width).toBe(
      19,
    );
  });

  it('never reports less than the minimum width', () => {
    expect(layoutText({ text: '', fontSize: 10, sizingMode: 'auto' }).width).toBe(
      MIN_TEXT_WIDTH,
    );
  });
});

describe('alignment offset', () => {
  it('places the click point on the edge the alignment anchors to', () => {
    expect(textAlignOffset(100, 'start')).toBe(0);
    expect(textAlignOffset(100, 'middle')).toBe(-50);
    expect(textAlignOffset(100, 'end')).toBe(-100);
  });
});

describe('typographical stabilization', () => {
  const base = {
    x: 100,
    y: 100,
    rotation: 0,
    props: {
      text: 'ab',
      color: '#000',
      fontSize: 10,
      fontFamily: 'sans' as const,
      fontWeight: 400 as const,
      sizingMode: 'auto' as const,
      width: 0,
      lineHeight: 1.2,
      align: 'start' as const,
    },
  };

  it('leaves start-aligned text alone while typing', () => {
    const next = { ...base.props, text: 'abcdef' };
    expect(stabilizeTextPosition(base, next)).toEqual({ x: 100, y: 100 });
  });

  it('holds the centre of middle-aligned text as it grows', () => {
    const shape = { ...base, props: { ...base.props, align: 'middle' as const } };
    const next = { ...shape.props, text: 'abcdef' };
    const grown = layoutTextProps(next).width - layoutTextProps(shape.props).width;

    const moved = stabilizeTextPosition(shape, next);
    expect(moved.x).toBeCloseTo(100 - grown / 2);
    // Centre before and centre after must coincide.
    expect(moved.x + layoutTextProps(next).width / 2).toBeCloseTo(
      100 + layoutTextProps(shape.props).width / 2,
    );
    // Typing must not move the shape vertically.
    expect(moved.y).toBe(100);
  });

  it('holds the right edge of end-aligned text as it grows', () => {
    const shape = { ...base, props: { ...base.props, align: 'end' as const } };
    const next = { ...shape.props, text: 'abcdef' };
    const moved = stabilizeTextPosition(shape, next);
    expect(moved.x + layoutTextProps(next).width).toBeCloseTo(
      100 + layoutTextProps(shape.props).width,
    );
  });

  it('grows about the vertical centre on a style change, not on a text change', () => {
    const bigger = { ...base.props, fontSize: 20 };
    const before = layoutTextProps(base.props).height;
    const after = layoutTextProps(bigger).height;
    expect(stabilizeTextPosition(base, bigger).y).toBeCloseTo(
      100 - (after - before) / 2,
    );
  });

  it('moves a rotated shape along its own axes', () => {
    const shape = {
      ...base,
      rotation: Math.PI / 2,
      props: { ...base.props, align: 'middle' as const },
    };
    const next = { ...shape.props, text: 'abcdef' };
    const grown = layoutTextProps(next).width - layoutTextProps(shape.props).width;
    const moved = stabilizeTextPosition(shape, next);
    // A quarter turn sends the horizontal correction down the y axis.
    expect(moved.x).toBeCloseTo(100);
    expect(moved.y).toBeCloseTo(100 - grown / 2);
  });

  it('is a no-op for fixed-width text, whose box the content cannot resize', () => {
    const shape = {
      ...base,
      props: {
        ...base.props,
        align: 'middle' as const,
        sizingMode: 'fixed' as const,
        width: 200,
      },
    };
    expect(stabilizeTextPosition(shape, { ...shape.props, text: 'abcdef' })).toEqual(
      { x: 100, y: 100 },
    );
  });

  it('is a no-op when neither the text nor the style changed', () => {
    expect(stabilizeTextPosition(base, { ...base.props })).toEqual({
      x: 100,
      y: 100,
    });
  });
});
