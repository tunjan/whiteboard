import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import { PALETTE } from './use-style-store';

// Zustand v5 serves `getInitialState()` to a server render, so the hook cannot
// see a document or selection store mutated from the test. Both are read-only
// here, so a fixed snapshot behind the same selector call is the whole of what
// it needs — and the style store, read at its initial state, stands for the
// style new shapes inherit before anyone touches a control.
const state = vi.hoisted(() => ({
  shapes: [] as Shape[],
  selectedIds: [] as string[],
}));

vi.mock('@/canvas/use-selection-store', () => ({
  useSelectionStore: (selector: (s: unknown) => unknown) =>
    selector({ selectedIds: state.selectedIds }),
}));

vi.mock('@/canvas/use-document-store', () => ({
  editor: { getShape: () => undefined, updateShape: () => undefined },
  useDocumentStore: (selector: (s: unknown) => unknown) =>
    selector({
      shapes: state.shapes,
      shapesById: new Map(state.shapes.map((shape) => [shape.id, shape])),
    }),
}));

const { useStyleControls } = await import('./use-style-controls');

function rectangle(id: string, color: string, size: number): Shape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: { w: 10, h: 10, color, size, fillStyle: 'solid', dash: 'dashed' },
  };
}

/** The controls as a surface would read them, for a given tool and selection. */
function controls(activeToolId: string, shapes: Shape[] = []) {
  state.shapes = shapes;
  state.selectedIds = shapes.map((shape) => shape.id);
  let read: ReturnType<typeof useStyleControls> | undefined;
  function Probe() {
    read = useStyleControls(activeToolId);
    return null;
  }
  renderToStaticMarkup(<Probe />);
  if (!read) throw new Error('the hook did not run');
  return read;
}

const INK = PALETTE.light[0]!.value;

describe('useStyleControls values', () => {
  it('reads the style new shapes inherit with nothing selected', () => {
    expect(controls('draw').values.color).toBe(INK);
  });

  // The selection is the subject while there is one, so the bar shows what an
  // edit would be changing rather than what the next shape would be drawn with.
  it('reads the selection instead, while there is one', () => {
    const { values } = controls('select', [rectangle('a', '#e03131', 10)]);
    expect(values.color).toBe('#e03131');
    expect(values.size).toBe(10);
    expect(values.dash).toBe('dashed');
  });

  // Nothing to show for a property the selection disagrees on, so the control
  // falls back rather than claiming one of the two values.
  it('falls back where the selection disagrees', () => {
    const { values } = controls('select', [
      rectangle('a', '#e03131', 10),
      rectangle('b', '#4465e9', 10),
    ]);
    expect(values.color).toBe(INK);
    expect(values.size).toBe(10);
  });
});
