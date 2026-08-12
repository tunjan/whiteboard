import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DrawPoint, DrawShape } from '@whiteboard/shared';
import { drawUtil } from './draw';

/**
 * A right-angle turn, sampled at the ~1-unit spacing a deliberate stroke
 * produces. Stabilization cuts the corner, so the ink and the raw samples part
 * company around the turn — exactly the case where hit-testing must follow the
 * ink. (Sampled finely on purpose: smoothing is a function of distance
 * travelled, so a corner reported in a couple of big jumps is one the engine
 * declines to round off, and there would be nothing to disagree about.)
 */
const corner: DrawPoint[] = [
  ...Array.from({ length: 31 }, (_, i) => ({ x: i, y: 0, pressure: 0.5 })),
  ...Array.from({ length: 30 }, (_, i) => ({ x: 30, y: i + 1, pressure: 0.5 })),
];

function stroke(streamline: number): DrawShape {
  return {
    id: 's',
    type: 'draw',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: {
      points: corner,
      isClosed: false,
      color: '#000000',
      size: 1,
      streamline,
    },
  };
}

describe('draw hit-testing', () => {
  const rawCorner = { x: 30, y: 0 };
  // On the arc the stabilized ink actually takes, 2.1 units inside the corner.
  const cutCorner = { x: 27.88, y: 2.47 };

  it('hits the drawn ink, not the raw samples', () => {
    const stabilized = stroke(1);
    expect(drawUtil.hitTest(stabilized, cutCorner, 0)).toBe(true);
    // The raw vertex is nowhere near the ink the user can see, so clicking it
    // must miss — before this it selected the stroke off an invisible line.
    expect(drawUtil.hitTest(stabilized, rawCorner, 0)).toBe(false);
  });

  it('falls back to the raw polyline when stabilization is off', () => {
    // The step weight is 1 at streamline 0, so the filter is the identity and
    // the centerline is the sample polyline.
    const unstabilized = stroke(0);
    expect(drawUtil.hitTest(unstabilized, rawCorner, 0)).toBe(true);
    expect(drawUtil.hitTest(unstabilized, cutCorner, 0)).toBe(false);
  });

  it('respects the tolerance and brush radius', () => {
    const unstabilized = stroke(0);
    const justOff = { x: 30, y: -1 };
    expect(drawUtil.hitTest(unstabilized, justOff, 0)).toBe(false);
    expect(drawUtil.hitTest(unstabilized, justOff, 1)).toBe(true);
  });

  it('hit-tests a single-point stroke as a dot', () => {
    const dot: DrawShape = {
      ...stroke(0.9),
      props: { ...stroke(0.9).props, points: [{ x: 0, y: 0, pressure: 0.5 }] },
    };
    expect(drawUtil.hitTest(dot, { x: 0.4, y: 0 }, 0)).toBe(true);
    expect(drawUtil.hitTest(dot, { x: 50, y: 0 }, 0)).toBe(false);
  });
});

describe('closed strokes', () => {
  /** A 40-unit box drawn back to just short of its own start. */
  const loop: DrawPoint[] = [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 40, y: 0, pressure: 0.5 },
    { x: 40, y: 40, pressure: 0.5 },
    { x: 0, y: 40, pressure: 0.5 },
    { x: 0, y: 2, pressure: 0.5 },
  ];

  function box(props: Partial<DrawShape['props']>): DrawShape {
    return {
      ...stroke(0),
      props: { ...stroke(0).props, points: loop, isClosed: true, ...props },
    };
  }

  const middle = { x: 20, y: 20 };

  it('takes a hit anywhere inside a filled loop', () => {
    expect(drawUtil.hitTest(box({ fillStyle: 'solid' }), middle, 0)).toBe(true);
    expect(drawUtil.hitTest(box({ fillStyle: 'hatch' }), middle, 0)).toBe(true);
  });

  it('leaves the interior of an unfilled loop empty', () => {
    // Nothing is painted there, so clicking through to whatever is underneath
    // is the only behaviour that matches what the user sees.
    expect(drawUtil.hitTest(box({ fillStyle: 'none' }), middle, 0)).toBe(false);
    expect(drawUtil.hitTest(box({}), middle, 0)).toBe(false);
  });

  /** Render the shape the way the PNG export does, off the DOM. */
  function markup(shape: DrawShape): string {
    return renderToStaticMarkup(
      createElement(drawUtil.Component, { shape }),
    );
  }

  it('paints the interior under the ink', () => {
    const svg = markup(box({ fillStyle: 'solid' }));
    // Two paths: the fill, closed back on itself, then the ink over it.
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg.indexOf('fill-opacity')).toBeLessThan(svg.lastIndexOf('<path'));
    expect(svg).toContain('Z"');
  });

  it('carries the hatch pattern its fill references', () => {
    const svg = markup(box({ fillStyle: 'hatch' }));
    expect(svg).toContain('<pattern id="hatch-s"');
    expect(svg).toContain('url(#hatch-s)');
  });

  it('stays a single path when there is nothing to fill', () => {
    expect(markup(box({ fillStyle: 'none' })).match(/<path/g)).toHaveLength(1);
  });

  it('ignores a fill on a stroke that never closed', () => {
    const open = box({ fillStyle: 'solid', isClosed: false });
    expect(drawUtil.hitTest(open, middle, 0)).toBe(false);
    // The ink itself still takes hits.
    expect(drawUtil.hitTest(open, { x: 20, y: 0 }, 0)).toBe(true);
  });
});
