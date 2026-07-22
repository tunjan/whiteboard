import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  caretForTextIndex,
  layoutText,
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
