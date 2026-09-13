// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import type { GraphShape } from '@whiteboard/shared';
import { graphUtil, plotArea } from './graph';
import { screenToGraph } from './graph-interaction';
import { ensureGraphMath } from '../graph-math';
import { createDefaultGraphProps } from '../graph-defaults';
import { editor, loadBoard } from '../use-document-store';
import { useCameraStore } from '../use-camera-store';
import { useSelectionStore } from '../use-selection-store';
import { useWheel } from '../use-wheel';

let root: Root;
let host: HTMLDivElement;
let closeBoard: () => void;
let graph: GraphShape;
let screenMatrix: DOMMatrix;
const camera = { x: 100, y: 75, z: 2 };

function Surface() {
  const ref = useRef<HTMLDivElement>(null);
  useWheel(ref);
  const Component = graphUtil.Component;
  return (
    <div ref={ref} style={{ pointerEvents: 'none' }}>
      <svg>
        <Component shape={{ ...graph, x: 0, y: 0, rotation: 0 }} />
      </svg>
    </div>
  );
}

beforeAll(ensureGraphMath);
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.useFakeTimers();
  closeBoard = loadBoard('graph-wheel-test', { persist: false, collab: false });
  useCameraStore.setState({ camera: { ...camera }, constraints: null });
  graph = {
    id: 'graph-wheel',
    type: 'graph',
    x: 350,
    y: 275,
    rotation: 0,
    index: 'a1',
    props: createDefaultGraphProps(),
  };
  editor.createShape(graph);
  useSelectionStore.setState({ selectedIds: [graph.id] });
  screenMatrix = new DOMMatrix().translate(500, 400).scale(2);
  vi.spyOn(SVGGraphicsElement.prototype, 'getScreenCTM').mockImplementation(
    () => screenMatrix,
  );
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(() => root.render(<Surface />));
});
afterEach(async () => {
  await act(() => root.unmount());
  closeBoard();
  host.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const group = () => host.querySelector('svg > g')!;
const viewport = () => (editor.getShape(graph.id) as GraphShape).props.viewport;
// Happy DOM's WheelEvent extends UIEvent rather than MouseEvent, so its
// constructor drops cursor coordinates and modifiers. Supply those DOM fields.
function wheelEvent(init: WheelEventInit) {
  return Object.assign(
    new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init }),
    {
      clientX: init.clientX ?? 0,
      clientY: init.clientY ?? 0,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false,
      shiftKey: init.shiftKey ?? false,
      altKey: init.altKey ?? false,
    },
  );
}
async function wheel(init: WheelEventInit) {
  await act(() => {
    group().dispatchEvent(wheelEvent(init));
  });
  await act(() => vi.advanceTimersByTime(20));
}

it('receives pointer events and pans the graph without moving the board', async () => {
  expect(getComputedStyle(group()).pointerEvents).toBe('auto');
  await wheel({ clientX: 920, clientY: 680, deltaY: 40 });
  expect(viewport().yMin).toBeCloseTo(-6 - (20 / 248) * 12);
  expect(useCameraStore.getState().camera).toEqual(camera);
});

it.each([0, 37, 90])(
  'anchors zoom in graph coordinates with a %s degree rotation',
  async (rotation) => {
    screenMatrix = new DOMMatrix()
      .translate(700, 250)
      .rotate(rotation)
      .scale(2);
    const local = new DOMPoint(300, 80);
    const cursor = local.matrixTransform(screenMatrix);
    const area = plotArea({ x: 0, y: 0, props: graph.props });
    const before = screenToGraph(local, viewport(), area);
    await wheel({
      clientX: cursor.x,
      clientY: cursor.y,
      deltaY: -10,
      ctrlKey: true,
    });
    const after = screenToGraph(local, viewport(), area);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
    expect(viewport().xMax - viewport().xMin).toBeCloseTo(20 / 1.1);
    expect(useCameraStore.getState().camera).toEqual(camera);
  },
);

it('pans along screen axes when the graph is rotated', async () => {
  screenMatrix = new DOMMatrix().translate(700, 250).rotate(90).scale(2);
  await wheel({ clientX: 500, clientY: 500, deltaY: 40 });
  expect(viewport().xMin).toBeCloseTo(-10 + (20 / 388) * 20);
  expect(viewport().yMin).toBeCloseTo(-6);
});

it('composes multiple wheel events before a frame', async () => {
  const event = {
    bubbles: true,
    cancelable: true,
    clientX: 920,
    clientY: 680,
    deltaY: -10,
    ctrlKey: true,
  };
  await act(() => {
    group().dispatchEvent(wheelEvent(event));
    group().dispatchEvent(wheelEvent(event));
  });
  await act(() => vi.advanceTimersByTime(20));
  expect(viewport().xMax - viewport().xMin).toBeCloseTo(20 / 1.1 ** 2);
  expect(useCameraStore.getState().camera).toEqual(camera);
});

it('leaves an unselected graph alone and lets the board handle the wheel', async () => {
  useSelectionStore.setState({ selectedIds: [] });
  await wheel({ clientX: 920, clientY: 680, deltaY: 40 });
  expect(viewport()).toEqual(graph.props.viewport);
  expect(useCameraStore.getState().camera.y).toBeCloseTo(camera.y + 20);
});
