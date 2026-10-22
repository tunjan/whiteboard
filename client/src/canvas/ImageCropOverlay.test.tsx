// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageShape, Shape } from '@whiteboard/shared';
import './shapes/register';
import { ImageCropOverlay } from './ImageCropOverlay';
import { editor, loadBoard } from './use-document-store';
import {
  useEndCropWhenGone,
  useImageCroppingStore,
} from './use-image-cropping-store';
import { useShape } from './use-shapes';

const image = {
  id: 'img',
  type: 'image',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a0',
  parentId: null,
  props: { blobId: '', w: 100, h: 80, naturalWidth: 100, naturalHeight: 80 },
} as unknown as Shape;

let host: HTMLDivElement, root: Root, closeBoard: () => void;

function Probe() {
  useEndCropWhenGone();
  const id = useImageCroppingStore((s) => s.croppingId);
  const shape = useShape(id);
  return shape ? <ImageCropOverlay shape={shape as ImageShape} /> : null;
}

beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  closeBoard = loadBoard('crop-overlay-test', { persist: false, collab: false });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  editor.createShape(image);
  useImageCroppingStore.getState().start('img');
  await act(() => root.render(<Probe />));
});
afterEach(async () => {
  await act(() => root.unmount());
  useImageCroppingStore.getState().stop();
  closeBoard();
  host.remove();
  vi.unstubAllGlobals();
});

describe('image crop mode', () => {
  it('keeps Escape from reaching the canvas, which would clear the selection', async () => {
    const canvasKeydown = vi.fn();
    window.addEventListener('keydown', canvasKeydown);
    await act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    window.removeEventListener('keydown', canvasKeydown);

    expect(useImageCroppingStore.getState().croppingId).toBeNull();
    expect(canvasKeydown).not.toHaveBeenCalled();
  });

  it('ends when the image being cropped is deleted', async () => {
    await act(() => editor.deleteShapes(['img']));
    expect(useImageCroppingStore.getState().croppingId).toBeNull();
  });
});
