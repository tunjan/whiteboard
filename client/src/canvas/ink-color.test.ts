import { describe, expect, it } from 'vitest';
import { inkPaint, inkShape, INK_PAINT } from './ink-color';
import { PALETTE } from './use-style-store';

const BLACK = PALETTE.light[0]!.value;
const WHITE = PALETTE.dark[0]!.value;

describe('inkPaint', () => {
  it('routes both ink values through the theme token', () => {
    expect(inkPaint(BLACK)).toBe(INK_PAINT);
    expect(inkPaint(WHITE)).toBe(INK_PAINT);
  });

  it('leaves every other swatch alone', () => {
    for (const { value } of [
      ...PALETTE.light.slice(1),
      ...PALETTE.dark.slice(1),
    ]) {
      expect(inkPaint(value), value).toBe(value);
    }
  });
});

describe('inkShape', () => {
  const shape = {
    id: 'a',
    type: 'draw',
    x: 0,
    y: 0,
    props: { color: BLACK, size: 2 },
  } as never;

  it('repaints ink without touching the rest of the shape', () => {
    const painted = inkShape(shape) as {
      id: string;
      props: { color: string; size: number };
    };
    expect(painted.props.color).toBe(INK_PAINT);
    expect(painted.props.size).toBe(2);
    expect(painted.id).toBe('a');
    // The document is untouched: peers on the other theme still hold the value
    // that was drawn.
    expect((shape as { props: { color: string } }).props.color).toBe(BLACK);
  });

  it('returns the same object when there is nothing to repaint', () => {
    const other = { ...(shape as object), props: { color: '#e03131' } };
    expect(inkShape(other as never)).toBe(other);
    const noColor = { ...(shape as object), props: {} };
    expect(inkShape(noColor as never)).toBe(noColor);
  });
});
