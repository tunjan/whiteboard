import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  ArrowShape,
  EllipseShape,
  LineShape,
  PolygonShape,
  RectangleShape,
} from '@whiteboard/shared';
import { arrowUtil } from './arrow';
import { ellipseUtil } from './ellipse';
import { lineUtil } from './line';
import { polygonUtil } from './polygon';
import { rectangleUtil } from './rectangle';

const base = {
  x: 10,
  y: 20,
  rotation: 0,
  index: 'a0',
};

function countPaths(markup: string): number {
  return markup.match(/<path/g)?.length ?? 0;
}

describe('draw stroke style renderers', () => {
  it('draws a deterministic two-pass rectangle over its exact fill geometry', () => {
    const shape: RectangleShape = {
      ...base,
      id: 'rectangle-1',
      type: 'rectangle',
      props: {
        ...rectangleUtil.getDefaultProps(),
        w: 120,
        h: 80,
        fillStyle: 'solid',
        dash: 'draw',
      },
    };
    const render = () =>
      renderToStaticMarkup(createElement(rectangleUtil.Component, { shape }));
    const markup = render();

    expect(render()).toBe(markup);
    expect(markup).toContain('<rect');
    expect(markup).toContain('fill-opacity="0.18"');
    expect(markup).toContain('stroke="none"');
    expect(countPaths(markup)).toBe(2);
  });

  it('draws a two-pass ellipse around its exact fill geometry', () => {
    const shape: EllipseShape = {
      ...base,
      id: 'ellipse-1',
      type: 'ellipse',
      props: {
        ...ellipseUtil.getDefaultProps(),
        w: 120,
        h: 80,
        fillStyle: 'hatch',
        dash: 'draw',
      },
    };
    const markup = renderToStaticMarkup(
      createElement(ellipseUtil.Component, { shape }),
    );

    expect(markup).toContain('<ellipse');
    expect(markup).toContain('<pattern');
    expect(countPaths(markup)).toBe(2);
  });

  it('draws a two-pass polygon', () => {
    const shape: PolygonShape = {
      ...base,
      id: 'polygon-1',
      type: 'polygon',
      props: {
        ...polygonUtil.getDefaultProps(),
        kind: 'hexagon',
        w: 120,
        h: 80,
        dash: 'draw',
      },
    };
    const markup = renderToStaticMarkup(
      createElement(polygonUtil.Component, { shape }),
    );

    expect(markup).toContain('<polygon');
    expect(countPaths(markup)).toBe(2);
  });

  it('draws two stable passes along line curve geometry', () => {
    const shape: LineShape = {
      ...base,
      id: 'line-1',
      type: 'line',
      props: {
        ...lineUtil.getDefaultProps(),
        points: [
          { x: 0, y: 0 },
          { x: 70, y: 50 },
          { x: 140, y: 0 },
        ],
        spline: 'smooth',
        dash: 'draw',
      },
    };
    const markup = renderToStaticMarkup(
      createElement(lineUtil.Component, { shape }),
    );

    expect(countPaths(markup)).toBe(2);
    expect(markup).toContain(' q ');
    expect(markup).not.toContain('stroke-dasharray');
  });

  it('synthesizes the arrow body and both heads independently', () => {
    const shape: ArrowShape = {
      ...base,
      id: 'arrow-1',
      type: 'arrow',
      props: {
        ...arrowUtil.getDefaultProps(),
        points: [
          { x: 0, y: 0 },
          { x: 140, y: 40 },
        ],
        arrowStart: true,
        arrowEnd: true,
        dash: 'draw',
      },
    };
    const markup = renderToStaticMarkup(
      createElement(arrowUtil.Component, { shape }),
    );

    // Two passes each for body, start head, and end head.
    expect(countPaths(markup)).toBe(6);
    expect(markup).not.toContain('stroke-dasharray');
  });
});
