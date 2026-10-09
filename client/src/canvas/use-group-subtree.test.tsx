// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import './shapes/register';
import { rectangleUtil } from './shapes/rectangle';
import { editor, loadBoard } from './use-document-store';
import { useGroupSubtree } from './use-group-subtree';

const rect = (id: string, x: number, parentId: string | null = null): Shape =>
  ({
    id,
    type: 'rectangle',
    x,
    y: 0,
    rotation: 0,
    index: `a${id}`,
    parentId,
    props: rectangleUtil.getDefaultProps(),
  }) as Shape;

let host: HTMLDivElement, root: Root, closeBoard: () => void;
let results: Shape[][] = [];

function Probe({ ids }: { ids: string[] }) {
  results.push(useGroupSubtree(ids));
  return null;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  closeBoard = loadBoard('group-subtree-test', { persist: false, collab: false });
  results = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  editor.createShape({
    id: 'g',
    type: 'group',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    parentId: null,
    props: {},
  } as Shape);
  editor.createShape(rect('1', 0, 'g'));
  editor.createShape(rect('2', 200, 'g'));
  editor.createShape(rect('3', 400));
});
afterEach(async () => {
  await act(() => root.unmount());
  closeBoard();
  host.remove();
  vi.unstubAllGlobals();
});

describe('useGroupSubtree', () => {
  it("returns a group's descendants and nothing for other shapes", async () => {
    await act(() => root.render(<Probe ids={['g', '3']} />));
    expect(results.at(-1)!.map((s) => s.id).sort()).toEqual(['1', '2']);
  });

  it('ignores edits outside the subtree and follows edits inside it', async () => {
    await act(() => root.render(<Probe ids={['g']} />));
    const renders = results.length;

    await act(() => editor.updateShape('3', { x: 500 }));
    expect(results.length).toBe(renders);

    await act(() => editor.updateShape('2', { x: 250 }));
    expect(results.length).toBe(renders + 1);
    expect(results.at(-1)!.find((s) => s.id === '2')!.x).toBe(250);
  });
});
