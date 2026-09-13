// @vitest-environment happy-dom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import { HoverLayer } from './HoverLayer';
import { lineUtil } from './shapes/line';
import { rectangleUtil } from './shapes/rectangle';
import { useCameraStore } from './use-camera-store';
import { editor, loadBoard } from './use-document-store';
import { useEnteredGroupStore } from './use-entered-group-store';
import { clearHover, updateHoverAt, useHoverStore } from './use-hover-store';
import { useSelectionStore } from './use-selection-store';

const rect = (id: string, x: number, extra: Partial<Shape> = {}): Shape =>
  ({
    id,
    type: 'rectangle',
    x,
    y: 0,
    rotation: 0,
    index: 'a1',
    parentId: null,
    ...extra,
    props: rectangleUtil.getDefaultProps(),
  }) as Shape;

let host: HTMLDivElement, root: Root, closeBoard: () => void;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  closeBoard = loadBoard('hover-test', { persist: false, collab: false });
  useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  useSelectionStore.getState().clear();
  useEnteredGroupStore.getState().exit();
  clearHover();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  closeBoard();
  host.remove();
  vi.unstubAllGlobals();
});

const mount = async (shapes: Shape[]) => {
  for (const s of shapes) editor.createShape(s);
  await act(() =>
    root.render(
      <StrictMode>
        <HoverLayer camera={{ x: 0, y: 0, z: 1 }} />
      </StrictMode>,
    ),
  );
};
const outline = () => host.querySelector('polygon');
const traced = () => host.querySelector('path');

describe('hover indicator', () => {
  it('outlines the box under the pointer and nothing over empty canvas', async () => {
    await mount([rect('a', 0)]);
    expect(outline()).toBeNull();

    await act(() => updateHoverAt({ x: 50, y: 50 }));
    expect(useHoverStore.getState().hoveredId).toBe('a');
    // Default rectangle is 100x100 at the origin, camera at 1:1.
    expect(outline()!.getAttribute('points')).toBe('0,0 100,0 100,100 0,100');

    await act(() => updateHoverAt({ x: 900, y: 900 }));
    expect(outline()).toBeNull();
  });

  it('traces a connector along its own outline instead of boxing it', async () => {
    await mount([
      {
        id: 'l',
        type: 'line',
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a2',
        parentId: null,
        props: {
          ...lineUtil.getDefaultProps(),
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
          ],
        },
      } as Shape,
    ]);
    await act(() => updateHoverAt({ x: 100, y: 0 }));
    expect(traced()).not.toBeNull();
    expect(outline()).toBeNull();
  });

  it('says nothing about a shape that is already selected', async () => {
    await mount([rect('a', 0)]);
    await act(() => useSelectionStore.getState().setSelection(['a']));
    await act(() => updateHoverAt({ x: 50, y: 50 }));
    expect(outline()).toBeNull();
  });

  it('names the group a click would catch, not the child under the pointer', async () => {
    await mount([
      {
        id: 'g',
        type: 'group',
        x: 0,
        y: 0,
        rotation: 0,
        index: 'a0',
        parentId: null,
        props: {},
      } as Shape,
      rect('child', 0, { parentId: 'g', index: 'a1' }),
      rect('far', 300, { parentId: 'g', index: 'a2' }),
    ]);
    await act(() => updateHoverAt({ x: 50, y: 50 }));
    expect(useHoverStore.getState().hoveredId).toBe('g');
    // The group's box spans both children — out to the half-stroke each one
    // paints outside its own outline — and is dashed like its selection box.
    expect(outline()!.getAttribute('points')).toBe(
      '-1,-1 401,-1 401,101 -1,101',
    );
    expect(outline()!.getAttribute('stroke-dasharray')).toBe('4 3');

    // Stepping into the group makes the child the target again.
    await act(() => useEnteredGroupStore.getState().enter('g'));
    await act(() => updateHoverAt({ x: 50, y: 50 }));
    expect(useHoverStore.getState().hoveredId).toBe('child');
  });

  it('re-renders only when the answer changes', async () => {
    await mount([rect('a', 0)]);
    const seen = vi.fn();
    const stop = useHoverStore.subscribe(seen);
    await act(() => {
      updateHoverAt({ x: 10, y: 10 });
      updateHoverAt({ x: 20, y: 20 });
      updateHoverAt({ x: 30, y: 30 });
    });
    expect(seen).toHaveBeenCalledTimes(1);
    stop();
  });
});
