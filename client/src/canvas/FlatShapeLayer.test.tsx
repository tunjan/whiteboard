// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { Shape, RectangleShape } from '@whiteboard/shared';
import './shapes/register';
import { rectangleUtil } from './shapes/rectangle';
import { shapeRegistry } from './shapes/shape-registry';
import { FlatShapeLayer } from './FlatShapeLayer';
import {
  useDocumentStore,
  spatialIndex,
  loadBoard,
  editor,
  breakUndoCapture,
  undo,
  redo,
} from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { useSelectionStore } from './use-selection-store';
import { drawUtil } from './shapes/draw';
import { beginLiveStroke, endLiveStroke } from './use-live-stroke-store';
import { useEraserStore } from './use-eraser-store';
import { renderTree } from './export-png';
import { renderToStaticMarkup } from 'react-dom/server';

const rect = (id: string, x = 0): RectangleShape => ({
  id,
  type: 'rectangle',
  x,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: rectangleUtil.getDefaultProps(),
});
let host: HTMLDivElement, root: Root, closeBoard: () => void;
const renders = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  closeBoard = loadBoard('engine-test', { persist: false, collab: false });
  useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  shapeRegistry.register({
    ...rectangleUtil,
    Component: ({ shape }) => {
      renders(shape.id);
      return (
        <foreignObject width="100" height="100">
          <iframe title={shape.id} src="about:blank" />
        </foreignObject>
      );
    },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  renders.mockClear();
});
afterEach(async () => {
  endLiveStroke();
  await act(() => root.unmount());
  closeBoard();
  host.remove();
  shapeRegistry.register(rectangleUtil);
  vi.unstubAllGlobals();
});
const element = (id: string) =>
  host.querySelector<HTMLDivElement>(`[data-shape-id="${id}"]`)!;
const mount = async (shapes: Shape[]) => {
  for (const s of shapes) editor.createShape(s);
  await act(() =>
    root.render(
      <StrictMode>
        <FlatShapeLayer width={800} height={600} />
      </StrictMode>,
    ),
  );
};

describe('flat DOM rendering', () => {
  it('keeps both highlight passes aligned, clipped, dimmed and culled', async () => {
    await mount([
      { id: 'frame', type: 'frame', x: 0, y: 0, rotation: 0, index: 'a0', props: { w: 400, h: 300, name: 'Page' } },
      { id: 'wash', type: 'draw', x: 20, y: 40, rotation: 0, index: 'a1', parentId: 'frame', opacity: 0.8,
        props: { ...drawUtil.getDefaultProps(), inkAlgorithm: 'reference', inkKind: 'highlight', thinning: 0, size: 20, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] } },
      { ...rect('content'), index: 'a2' },
    ]);
    const underlay = element('wash');
    const overlay = host.querySelector<HTMLDivElement>('[data-highlight-overlay="wash"]')!;
    expect(underlay.querySelector('g[opacity="0.82"]')).not.toBeNull();
    expect(overlay.querySelector('g[opacity="0.35"]')).not.toBeNull();
    expect(Number(overlay.style.zIndex)).toBeGreaterThan(Number(element('content').style.zIndex));
    expect(overlay.style.clipPath).toBe(underlay.style.clipPath);
    await act(() => editor.updateShape('wash', { x: 80, rotation: 0.3 }));
    expect(overlay.style.transform).toBe(underlay.style.transform);
    await act(() => useEraserStore.setState({ marked: { wash: true } }));
    expect(Number(overlay.style.opacity)).toBeCloseTo(0.8 * 0.32);
    expect(overlay.style.opacity).toBe(underlay.style.opacity);
    await act(() => beginLiveStroke('wash'));
    expect(underlay.style.visibility).toBe('visible');
    expect(overlay.style.visibility).toBe('hidden');
    await act(() => endLiveStroke());
    expect(overlay.style.visibility).toBe('visible');
    await act(() => editor.updateShape('wash', { x: 100000 }));
    expect(overlay.style.display).toBe('none');
    expect(underlay.style.display).toBe('none');
    useEraserStore.setState({ marked: {} });
  });

  it('exports the background wash before content and its tint after content', async () => {
    await mount([
      { id: 'wash', type: 'draw', x: 20, y: 40, rotation: 0, index: 'a0',
        props: { ...drawUtil.getDefaultProps(), inkAlgorithm: 'reference', inkKind: 'highlight', thinning: 0, size: 20, points: [{ x: 0, y: 0 }, { x: 200, y: 0 }] } },
      rect('content'),
    ]);
    const markup = renderToStaticMarkup(renderTree());
    const below = markup.indexOf('opacity="0.82"');
    const content = markup.indexOf('title="content"');
    const above = markup.indexOf('opacity="0.35"');
    expect(below).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(below);
    expect(above).toBeGreaterThan(content);
  });
  it('retains containers and embedded DOM through transforms, reparenting, reorder, culling, and undo', async () => {
    await mount([
      rect('a'),
      rect('b', 200),
      {
        id: 'frame',
        type: 'frame',
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a0',
        props: { w: 300, h: 300, name: 'Frame' },
      },
    ]);
    const container = element('a'),
      iframe = container.querySelector('iframe'),
      count = renders.mock.calls.length;
    await act(() =>
      editor.updateShape('a', {
        x: 50,
        y: 20,
        rotation: 0.3,
        parentId: 'frame',
        index: 'a9',
      }),
    );
    expect(element('a')).toBe(container);
    expect(container.querySelector('iframe')).toBe(iframe);
    expect(renders).toHaveBeenCalledTimes(count);
    expect(container.style.transform).not.toBe('matrix(1,0,0,1,0,0)');
    expect(container.style.clipPath).toContain('polygon(');
    expect(element('b').parentElement).toBe(container.parentElement);
    expect(Number(container.style.zIndex)).toBeLessThan(
      Number(element('b').style.zIndex),
    );
    await act(() =>
      useCameraStore.setState({ camera: { x: 100000, y: 0, z: 1 } }),
    );
    expect(container.style.display).toBe('none');
    expect(container.querySelector('iframe')).toBe(iframe);
    await act(() => useSelectionStore.getState().setSelection(['a']));
    expect(container.style.display).toBe('');
    await act(() =>
      useCameraStore.setState({ camera: { x: 0, y: 0, z: 1.1 } }),
    );
    expect(
      host.querySelector('[data-shape-layer]')?.getAttribute('style'),
    ).toContain('matrix(1.1');
    expect(renders).toHaveBeenCalledTimes(count);
    breakUndoCapture();
    await act(() => editor.updateShape('a', { props: { w: 120 } }));
    expect(renders.mock.calls.length).toBeGreaterThan(count);
    expect(container.querySelector('iframe')).toBe(iframe);
    await act(() => undo());
    expect(editor.getShape('a')?.props).toHaveProperty('w', 100);
    await act(() => redo());
    expect(editor.getShape('a')?.props).toHaveProperty('w', 120);
    expect(container.querySelector('iframe')).toBe(iframe);
  });

  it('updates actual Yjs ink content but skips React for ink translations', async () => {
    const draw: Shape = {
      id: 'ink',
      type: 'draw',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 20, y: 20, pressure: 0.5 },
        ],
        color: '#000',
        size: 4,
        dash: 'solid',
        isClosed: false,
        simulatePressure: true,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      },
    };
    await mount([draw]);
    const path = element('ink').querySelector('path')!;
    const before = path.getAttribute('d');
    await act(() =>
      editor.updateShape('ink', {
        props: {
          points: [...draw.props.points, { x: 70, y: 10, pressure: 0.6 }],
        },
      }),
    );
    expect(path.getAttribute('d')).not.toBe(before);
    const content = element('ink').innerHTML;
    await act(() => editor.updateShape('ink', { x: 60, rotation: 0.4 }));
    expect(element('ink').innerHTML).toBe(content);
  });

  it('unsubscribes on unmount and leaves offscreen records resident', async () => {
    await mount([rect('far', 100000)]);
    const container = element('far');
    expect(container.style.display).toBe('none');
    await act(() => root.unmount());
    const transform = container.style.transform;
    await act(() => editor.updateShape('far', { x: 200 }));
    expect(container.style.transform).toBe(transform);
    expect(spatialIndex.has('far')).toBe(true);
    expect(useDocumentStore.getState().shapesById.has('far')).toBe(true);
    root = createRoot(host);
  });
});
