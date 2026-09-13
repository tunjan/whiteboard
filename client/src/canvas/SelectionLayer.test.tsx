import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';

// Zustand v5 serves `getInitialState()` to server renders, so the layer cannot
// see a store mutated from the test. Both stores are read-only here — the
// layer never writes — so a fixed snapshot behind the same selector call is
// the whole of what it needs.
const state = vi.hoisted(() => ({
  shapes: [] as Shape[],
  selectedIds: [] as string[],
}));

vi.mock('./use-selection-store', () => ({
  useSelectionStore: (selector: (s: unknown) => unknown) =>
    selector({
      selectedIds: state.selectedIds,
      marquee: null,
      snapGuides: [],
      gestureCursor: null,
    }),
}));

vi.mock('./use-document-store', () => ({
  useDocumentStore: (selector: (s: unknown) => unknown) =>
    selector({
      shapes: state.shapes,
      shapesById: new Map(state.shapes.map((s) => [s.id, s])),
    }),
}));

const { SelectionLayer } = await import('./SelectionLayer');
const { DEFAULT_CAMERA } = await import('./camera');
const { lineUtil } = await import('./shapes/line');
const { rectangleUtil } = await import('./shapes/rectangle');
await import('./shapes/register');

const line: Shape = {
  id: 'l1',
  type: 'line',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: {
    ...lineUtil.getDefaultProps(),
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
    ],
  },
};

const box: Shape = {
  id: 'r1',
  type: 'rectangle',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a2',
  props: { ...rectangleUtil.getDefaultProps(), w: 40, h: 40 },
};

function markupFor(shapes: Shape[], selectedIds: string[]): string {
  state.shapes = shapes;
  state.selectedIds = selectedIds;
  return renderToStaticMarkup(
    createElement(SelectionLayer, { camera: DEFAULT_CAMERA }),
  );
}

const TRACE = 'M 0 0 L 100 0 L 100 80';

describe('SelectionLayer', () => {
  it('traces a selected line instead of boxing it', () => {
    const markup = markupFor([line], ['l1']);
    expect(markup).toContain(TRACE);
    expect(markup).not.toContain('<polygon');
  });

  it('still boxes shapes that have no outline of their own', () => {
    const markup = markupFor([box], ['r1']);
    expect(markup).toContain('<polygon');
  });

  it('traces line members of a multi-selection', () => {
    const markup = markupFor([line, box], ['l1', 'r1']);
    expect(markup).toContain(TRACE);
    // The selection box still shows, and exactly one membership outline is
    // drawn — the rectangle's; the line contributes the traced path instead.
    expect(markup).toContain('<polygon');
    expect(markup.match(/<polygon[^>]*opacity="0\.5"/g) ?? []).toHaveLength(1);
  });

  it('turns a membership outline with the shape it belongs to', () => {
    const turned: Shape = { ...box, id: 'r2', rotation: Math.PI / 4 };
    const markup = markupFor([box, turned], ['r1', 'r2']);
    const outlines = markup.match(/<polygon[^>]*opacity="0\.5"[^>]*>/g) ?? [];
    expect(outlines).toHaveLength(2);
    // A 40x40 box turned an eighth turn spans 40*sqrt(2) across, but no
    // corner of its outline may sit on that envelope's corners: an
    // axis-aligned box would put all four there and stand clear of the shape.
    const corners = outlines[1]!.match(/points="([^"]+)"/)![1]!.split(' ');
    expect(corners).toHaveLength(4);
    const xs = corners.map((c) => Number(c.split(',')[0]));
    const ys = corners.map((c) => Number(c.split(',')[1]));
    const width = Math.max(...xs) - Math.min(...xs);
    expect(width).toBeCloseTo(40 * Math.SQRT2, 3);
    for (let i = 0; i < 4; i++) {
      // Each corner sits at the midpoint of one side of that envelope.
      const onCornerOfEnvelope =
        (xs[i] === Math.min(...xs) || xs[i] === Math.max(...xs)) &&
        (ys[i] === Math.min(...ys) || ys[i] === Math.max(...ys));
      expect(onCornerOfEnvelope).toBe(false);
    }
  });

  it('gives every connector handle a grab zone that is its hover halo', () => {
    const markup = markupFor([line], ['l1']);
    // Three vertices and two insert points, each with a halo circle.
    expect(markup.match(/group-hover:opacity-100/g) ?? []).toHaveLength(5);
    expect(markup.match(/cursor:grab/g) ?? []).toHaveLength(5);
  });
});
