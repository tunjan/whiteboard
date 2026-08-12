import { afterEach, describe, expect, it } from 'vitest';
import type { CustomStickerMeta, Shape } from '@whiteboard/shared';
import '../shapes/register';
import type { Editor } from '../editor';
import { customStickerSize, STICKER_DEFAULT_SIZE } from '../shapes/sticker';
import { useCustomStickersStore } from '../use-custom-stickers-store';
import { useStyleStore } from '../use-style-store';
import { createStickerTool } from './sticker-tool';
import type { ToolContext, ToolPointerInfo } from './types';

function pointer(x: number, y: number): ToolPointerInfo {
  return {
    point: { x, y },
    screenPoint: { x, y },
    timestamp: 0,
    zoom: 1,
    pressure: 0.5,
    pointerType: 'mouse',
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    button: 0,
  };
}

function context(): { ctx: ToolContext; shapes: Map<string, Shape> } {
  const shapes = new Map<string, Shape>();
  const editor = {
    getShape: (id: string) => shapes.get(id),
    getShapes: () => [...shapes.values()],
    createShape: (shape: Shape) => shapes.set(shape.id, shape),
    updateShape: () => undefined,
    deleteShapes: () => undefined,
    transact: (fn: () => void) => fn(),
  } as unknown as Editor;
  return {
    ctx: { editor, setTool: () => undefined, complete: () => undefined },
    shapes,
  };
}

function sticker(overrides: Partial<CustomStickerMeta> = {}): CustomStickerMeta {
  return {
    id: 'custom-1',
    blobId: `${'a'.repeat(64)}.png`,
    label: 'Mascot',
    width: 400,
    height: 200,
    addedBy: 'Ada',
    createdAt: 1,
    ...overrides,
  };
}

function stamped(shapes: Map<string, Shape>) {
  const shape = [...shapes.values()][0];
  return shape?.type === 'sticker' ? shape : undefined;
}

afterEach(() => {
  useCustomStickersStore.getState().reset();
  useStyleStore.getState().setStickerId('thumbs-up');
});

describe('customStickerSize', () => {
  it('fits the source aspect into the default stamp box', () => {
    expect(customStickerSize(400, 200)).toEqual({
      w: STICKER_DEFAULT_SIZE,
      h: STICKER_DEFAULT_SIZE / 2,
    });
    expect(customStickerSize(100, 300)).toEqual({
      w: STICKER_DEFAULT_SIZE / 3,
      h: STICKER_DEFAULT_SIZE,
    });
  });

  it('falls back to the default box for a degenerate size', () => {
    expect(customStickerSize(0, 0)).toEqual({
      w: STICKER_DEFAULT_SIZE,
      h: STICKER_DEFAULT_SIZE,
    });
  });
});

describe('sticker tool', () => {
  it('stamps a built-in with no artwork blob', () => {
    const { ctx, shapes } = context();
    useStyleStore.getState().setStickerId('star');

    createStickerTool().onPointerDown?.(pointer(50, 50), ctx);

    expect(stamped(shapes)?.props).toMatchObject({
      sticker: 'star',
      w: STICKER_DEFAULT_SIZE,
      h: STICKER_DEFAULT_SIZE,
    });
    expect(stamped(shapes)?.props.blobId).toBeUndefined();
  });

  it('carries a board sticker’s artwork and aspect onto the stamp', () => {
    const { ctx, shapes } = context();
    const meta = sticker();
    useCustomStickersStore.getState().setStickers({ [meta.id]: meta });
    useStyleStore.getState().setStickerId(meta.id);

    createStickerTool().onPointerDown?.(pointer(50, 50), ctx);

    const shape = stamped(shapes);
    expect(shape?.props).toMatchObject({
      sticker: meta.id,
      blobId: meta.blobId,
      w: STICKER_DEFAULT_SIZE,
      h: STICKER_DEFAULT_SIZE / 2,
    });
    // Centred on the pointer, at the artwork's own size.
    expect(shape?.x).toBe(50 - STICKER_DEFAULT_SIZE / 2);
    expect(shape?.y).toBe(50 - STICKER_DEFAULT_SIZE / 4);
  });

  it('falls back to catalog art when the selected sticker left the library', () => {
    const { ctx, shapes } = context();
    // A peer removed it between the pick and the stamp.
    useStyleStore.getState().setStickerId('custom-gone');

    createStickerTool().onPointerDown?.(pointer(0, 0), ctx);

    expect(stamped(shapes)?.props.blobId).toBeUndefined();
  });
});
