import { describe, expect, it } from 'vitest';
import {
  caretForTextIndex,
  layoutText,
  textIndexAtPoint,
  textSelectionRects,
} from './text-measure';

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
