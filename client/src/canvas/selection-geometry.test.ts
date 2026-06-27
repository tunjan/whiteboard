import { describe, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import { matchesMarquee } from './selection-geometry';

function rectangle(overrides: Partial<Extract<Shape, { type: 'rectangle' }>> = {}) {
  return {
    id: 'rectangle',
    type: 'rectangle' as const,
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      w: 100,
      h: 60,
      color: '#111',
      fillStyle: 'solid' as const,
      dash: 'solid' as const,
      size: 2,
    },
    ...overrides,
  };
}

function line(overrides: Partial<Extract<Shape, { type: 'line' }>> = {}) {
  return {
    id: 'line',
    type: 'line' as const,
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      color: '#111',
      size: 4,
      dash: 'solid' as const,
      bend: 0,
    },
    ...overrides,
  };
}

describe('directional marquee geometry', () => {
  it('contains rotated filled shapes only when the full visible region fits', () => {
    const shape = rectangle({ rotation: Math.PI / 4 });

    expect(
      matchesMarquee(shape, { minX: -20, minY: -30, maxX: 120, maxY: 100 }, 'contain'),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: 0, minY: 0, maxX: 100, maxY: 60 }, 'contain'),
    ).toBe(false);
  });

  it('does not treat the hollow interior of an outlined box as a touch', () => {
    const shape = rectangle({
      props: {
        ...rectangle().props,
        fillStyle: 'none',
      },
    });

    expect(
      matchesMarquee(shape, { minX: 40, minY: 20, maxX: 60, maxY: 40 }, 'touch'),
    ).toBe(false);
    expect(
      matchesMarquee(shape, { minX: -2, minY: 20, maxX: 4, maxY: 40 }, 'touch'),
    ).toBe(true);
  });

  it('finds a stroke that crosses the marquee even when neither endpoint is inside', () => {
    const shape = line();

    expect(
      matchesMarquee(shape, { minX: 40, minY: -3, maxX: 60, maxY: 3 }, 'touch'),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: -3, minY: -3, maxX: 103, maxY: 3 }, 'contain'),
    ).toBe(true);
    expect(
      matchesMarquee(shape, { minX: 40, minY: -3, maxX: 60, maxY: 3 }, 'contain'),
    ).toBe(false);
  });
});
