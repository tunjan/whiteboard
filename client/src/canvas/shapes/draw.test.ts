import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DrawPoint, DrawProps, DrawShape } from '@whiteboard/shared';
import { buildInkRender, drawUtil } from './draw';
import { getInkCenterlinePath } from './ink';

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

  it('reserves the width positive thinning gives a heavy stroke', () => {
    // Thinning moves the radius away from half the brush in both directions,
    // but only the negative side was reserved for. At the pencil's own default
    // thinning a full-pressure stroke is drawn three quarters of a brush wide
    // — so the last third of it was outside its own bounds, culled early and
    // unclickable.
    const heavy: DrawShape = {
      ...stroke(0),
      props: {
        ...stroke(0).props,
        points: Array.from({ length: 80 }, (_, i) => ({
          x: i * 2,
          y: 0,
          pressure: 1,
        })),
        size: 20,
        thinning: 0.5,
        pressureEasing: 'smoothstep',
      },
    };

    // 16.875 = 20 * smoothstep(0.75), the outline's own half width here.
    expect(drawUtil.getBounds(heavy).maxY).toBeGreaterThanOrEqual(16.875);
    expect(drawUtil.hitTest(heavy, { x: 80, y: 16 }, 0)).toBe(true);
    expect(drawUtil.hitTest(heavy, { x: 80, y: 25 }, 0)).toBe(false);
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

describe('draw resizing', () => {
  /** A short pencil stroke: the ink margin is most of its box. */
  const short: DrawShape = {
    ...stroke(0),
    x: 100,
    y: 50,
    props: {
      ...stroke(0).props,
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 5, y: 3, pressure: 0.5 },
        { x: 10, y: 0, pressure: 0.5 },
      ],
      size: 4,
      thinning: 0.5,
    },
  };

  function boundsAfter(shape: DrawShape, next: ReturnType<typeof drawUtil.resize>) {
    return drawUtil.getBounds({
      ...shape,
      x: next.x,
      y: next.y,
      props: next.props as DrawShape['props'],
    });
  }

  it('leaves a stroke untouched when resized to its own bounds', () => {
    // Grabbing a handle without moving resizes to exactly this box; the
    // stroke used to grow and shift on that first sample.
    const next = drawUtil.resize(short, drawUtil.getBounds(short));
    expect(next.x).toBeCloseTo(short.x, 9);
    expect(next.y).toBeCloseTo(short.y, 9);
    expect(next.props.points).toEqual(short.props.points);
  });

  it('lands on the requested box', () => {
    const b = drawUtil.getBounds(short);
    const target = { ...b, maxX: b.maxX + 20, maxY: b.maxY + 10 };
    const after = boundsAfter(short, drawUtil.resize(short, target));
    expect(after.minX).toBeCloseTo(target.minX, 9);
    expect(after.minY).toBeCloseTo(target.minY, 9);
    expect(after.maxX).toBeCloseTo(target.maxX, 9);
    expect(after.maxY).toBeCloseTo(target.maxY, 9);
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
    return renderToStaticMarkup(createElement(drawUtil.Component, { shape }));
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

describe('the shared ink geometry', () => {
  // Two renderers draw a stroke: this util, for everything the document holds,
  // and the active-stroke layer, for the one the local pointer is making —
  // which writes SVG attributes directly, off the React path, to get the ink
  // down before the frame it belongs to is painted. They agree because they
  // call the same function, and this is the test that says so.
  const variants: Array<[string, Partial<DrawShape['props']>]> = [
    ['solid', { dash: 'solid' }],
    ['dashed', { dash: 'dashed' }],
    ['dotted', { dash: 'dotted' }],
    ['hand-drawn', { dash: 'draw' }],
    ['tapered', { dash: 'solid', startTaper: 12, endTaper: true }],
    ['thinned', { dash: 'solid', thinning: -0.4 }],
  ];

  for (const [name, overrides] of variants) {
    it(`renders a ${name} stroke from the same paths the layer draws`, () => {
      const shape = stroke(0.5);
      shape.props = { ...shape.props, ...overrides };
      const svg = renderToStaticMarkup(
        createElement(drawUtil.Component, { shape }),
      );
      const render = buildInkRender(shape.props, corner, false, 0);

      expect(svg).toContain(`d="${render.d}"`);
      if (render.dash?.strokeDasharray) {
        expect(svg).toContain(
          `stroke-dasharray="${render.dash.strokeDasharray}"`,
        );
        expect(svg).toContain(
          `stroke-dashoffset="${render.dash.strokeDashoffset}"`,
        );
      }
    });
  }
});

/**
 * A long, genuinely curved stroke at the ~1-unit sampling a deliberate hand
 * produces. The two-straight-runs `corner` fixture is the wrong shape to judge
 * the fallback by: its ribbon simplifies almost to nothing, while a real
 * stroke's cannot.
 */
function spiral(n: number): DrawPoint[] {
  const points: DrawPoint[] = [];
  let angle = 0;
  for (let i = 0; i < n; i++) {
    const radius = 20 + i * 0.25;
    angle += 1 / (1 + radius * 0.08);
    points.push({
      x: Math.cos(angle) * radius + Math.sin(i * 0.7) * 0.35,
      y: Math.sin(angle) * radius + Math.cos(i * 0.9) * 0.35,
      pressure: 0.5 + Math.sin(i * 0.05) * 0.2,
    });
  }
  return points;
}

describe('ink level-of-detail fallback', () => {
  it('strokes the conditioned centerline instead of filling the outline', () => {
    const props = stroke(0.5).props;
    const simplified = buildInkRender(props, corner, false, 0, true);

    expect(simplified.stroked).toBe(true);
    expect(simplified.dash).toBeNull();
    // The very curve a dashed stroke of the same shape traces, so the fallback
    // follows the ink it replaces rather than approximating it separately.
    expect(simplified.d).toBe(getInkCenterlinePath(corner, props.size, 0.5));
    expect(buildInkRender(props, corner, false, 0).stroked).toBe(false);
  });

  it('is cheaper than the outline it replaces', () => {
    const points = spiral(600);
    const props = stroke(0.5).props;
    const ribbon = buildInkRender(props, points, false, 0);
    const simplified = buildInkRender(props, points, false, 0, true);
    // Roughly half the path data on a realistic stroke. The whole point of the
    // fallback is that it is cheaper, so a change that inverted this would be
    // taking the visual cost without the saving.
    expect(simplified.d.length).toBeLessThan(ribbon.d.length * 0.75);
  });

  it('keeps a dot, which has no centerline to stroke', () => {
    const props = stroke(0.5).props;
    const render = buildInkRender(props, [{ x: 0, y: 0, pressure: 0.5 }], false, 0, true);
    // Falling through to the outline is what keeps it visible; a stroked path
    // of one point would draw nothing at all.
    expect(render.stroked).toBe(false);
    expect(render.d).not.toBe('');
  });

  it('still paints the fill of a closed stroke', () => {
    const props: DrawProps = {
      ...stroke(0.5).props,
      isClosed: true,
      fillStyle: 'solid',
    };
    const render = buildInkRender(props, corner, false, 0, true);
    expect(render.fillPath).toBe(`${render.d} Z`);
  });
});
