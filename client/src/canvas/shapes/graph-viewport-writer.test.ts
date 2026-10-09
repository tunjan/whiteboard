// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { GraphShape, GraphViewport } from '@whiteboard/shared';
import { createDefaultGraphProps } from '../graph-defaults';
import { editor, loadBoard } from '../use-document-store';
import { createGraphViewportWriter } from './graph-viewport-writer';

let closeBoard: () => void;
const id = 'graph-writer';
const viewport = () => (editor.getShape(id) as GraphShape).props.viewport;
const shift = (v: GraphViewport): GraphViewport => ({
  xMin: v.xMin + 1,
  xMax: v.xMax + 1,
  yMin: v.yMin,
  yMax: v.yMax,
});

beforeEach(() => {
  vi.useFakeTimers();
  closeBoard = loadBoard('graph-writer-test', { persist: false, collab: false });
  editor.createShape({
    id,
    type: 'graph',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: createDefaultGraphProps(),
  } as GraphShape);
});
afterEach(() => {
  closeBoard();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('composes edits within a frame into one document write', () => {
  const update = vi.spyOn(editor, 'updateShape');
  const onCommit = vi.fn();
  const writer = createGraphViewportWriter(id, onCommit);
  writer.update(shift);
  writer.update(shift);
  writer.update(shift);
  expect(update).not.toHaveBeenCalled();
  vi.advanceTimersByTime(20);
  expect(update).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(viewport().xMin).toBe(-7);
});

it('flush writes the pending edit now and drops the scheduled frame', () => {
  const update = vi.spyOn(editor, 'updateShape');
  const writer = createGraphViewportWriter(id);
  writer.update(shift);
  writer.flush();
  expect(viewport().xMin).toBe(-9);
  vi.advanceTimersByTime(20);
  expect(update).toHaveBeenCalledTimes(1);
});
