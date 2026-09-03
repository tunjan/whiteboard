import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { LineShape, LineSpline } from '@whiteboard/shared';
import { lineUtil } from './line';

function line(
  points: { x: number; y: number }[],
  extra: { bend?: number; spline?: LineSpline; rotation?: number } = {},
): LineShape {
  return {
    id: 'l1',
    type: 'line',
    x: 40,
    y: 25,
    rotation: extra.rotation ?? 0,
    index: 'a1',
    props: {
      ...lineUtil.getDefaultProps(),
      points,
      bend: extra.bend ?? 0,
      spline: extra.spline ?? 'linear',
    },
  };
}

/**
 * The selection outline is only "conformal" if it is the *same* path the shape
 * renders. Comparing against the rendered markup is what keeps the two from
 * drifting apart as the curve modes change.
 */
function renderedPath(shape: LineShape): {
  d: string;
  transform: string;
} {
  const markup = renderToStaticMarkup(
    createElement(lineUtil.Component, { shape }),
  );
  const d = /<path d="([^"]*)"/.exec(markup)?.[1] ?? '';
  const transform = /<g transform="([^"]*)"/.exec(markup)?.[1] ?? '';
  return { d, transform };
}

describe('line indicator path', () => {
  it.each([
    [
      'polyline',
      line([
        { x: 0, y: 0 },
        { x: 50, y: 0 },
        { x: 50, y: 60 },
      ]),
    ],
    [
      'arc',
      line(
        [
          { x: 0, y: 0 },
          { x: 80, y: 0 },
        ],
        { bend: 30 },
      ),
    ],
    [
      'smooth spline',
      line(
        [
          { x: 0, y: 0 },
          { x: 40, y: 30 },
          { x: 90, y: 10 },
        ],
        {
          spline: 'smooth',
        },
      ),
    ],
    [
      'rotated',
      line(
        [
          { x: 0, y: 0 },
          { x: 50, y: 20 },
        ],
        { rotation: Math.PI / 5 },
      ),
    ],
  ])('traces the rendered stroke (%s)', (_name, shape) => {
    const rendered = renderedPath(shape);
    expect(rendered.d).not.toBe('');
    expect(lineUtil.getIndicatorPath?.(shape)).toEqual(rendered);
  });

  it('has nothing to trace below two points', () => {
    expect(lineUtil.getIndicatorPath?.(line([]))).toBeNull();
    expect(lineUtil.getIndicatorPath?.(line([{ x: 0, y: 0 }]))).toBeNull();
  });
});
