import { afterEach, expect, it } from 'vitest';
import type { Shape } from '@whiteboard/shared';
import '@/canvas/shapes/register';
import { createPage } from '@/canvas/page-actions';
import { editor, loadBoard, useDocumentStore } from '@/canvas/use-document-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { setBoardAccess } from './board-access';

afterEach(() => setBoardAccess('pending'));

it('a view-only link changes nothing and keeps only the looking tools', () => {
  const dispose = loadBoard('view-only-test', { persist: false, collab: false });
  const rect = (id: string) =>
    ({
      id,
      type: 'rectangle',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a1',
      props: { w: 10, h: 10, color: '#000000', fillStyle: 'none', dash: 'solid', size: 'm' },
    }) as unknown as Shape;

  setBoardAccess('view');
  editor.createShape(rect('blocked'));
  expect(editor.getShape('blocked')).toBeUndefined();
  const pages = useDocumentStore.getState().doc.pageOrder.length;
  expect(createPage('Nope')).toBe('');
  expect(useDocumentStore.getState().doc.pageOrder.length).toBe(pages);
  useToolStore.getState().setTool('draw');
  expect(useToolStore.getState().activeToolId).not.toBe('draw');
  useToolStore.getState().setTool('laser');
  expect(useToolStore.getState().activeToolId).toBe('laser');

  setBoardAccess('edit');
  editor.createShape(rect('allowed'));
  expect(editor.getShape('allowed')).toBeDefined();
  dispose();
});
