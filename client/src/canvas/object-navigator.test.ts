import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import { canvasObjectLabel } from './object-navigator';

function shape(
  id: string,
  type: Shape['type'],
  props: Record<string, unknown>,
): Shape {
  return {
    id,
    type,
    x: 0,
    y: 0,
    rotation: 0,
    index: id,
    props,
  } as unknown as Shape;
}

describe('canvas object labels', () => {
  it('uses meaningful content for text, equations, and frames', () => {
    expect(
      canvasObjectLabel(shape('a', 'text', { text: '  Area   model  ' }), 0),
    ).toBe('Text: Area model');
    expect(
      canvasObjectLabel(shape('b', 'equation', { latex: 'x^2 + y^2' }), 1),
    ).toBe('Equation: x^2 + y^2');
    expect(
      canvasObjectLabel(shape('c', 'frame', { name: 'Worked example' }), 2),
    ).toBe('Frame: Worked example');
  });

  it('numbers plain shapes by ordinal and reads stickers by name', () => {
    expect(canvasObjectLabel(shape('a', 'rectangle', {}), 0)).toBe(
      'Rectangle 1',
    );
    expect(
      canvasObjectLabel(shape('b', 'sticker', { sticker: 'thumbs-up' }), 1),
    ).toBe('Sticker: thumbs up');
  });
});
