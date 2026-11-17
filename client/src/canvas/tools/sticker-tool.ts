import { StickerGlyph } from '@/components/ui/glyphs';
import { genId, type Shape, type StickerProps } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { customStickerSize } from '../shapes/sticker';
import { useCustomStickersStore } from '../use-custom-stickers-store';
import { useStickerPopStore } from '../use-sticker-pop-store';
import { useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/**
 * Click-to-stamp tool. Unlike the other creation tools it does not call
 * `ctx.complete()`: stamping several reactions in a row is the point, so the
 * tool stays armed until Escape or another tool. The stamped shape is left
 * unselected for the same reason — a selection box under a non-select tool
 * would only be in the way of the next stamp.
 *
 * Hidden from the flat button list: the toolbar's sticker picker is its button,
 * and the picked sticker comes from the style store (same pattern as polygon).
 */
export function createStickerTool(): Tool {
  return {
    id: 'sticker',
    label: 'Sticker',
    hotkey: 's',
    cursor: 'crosshair',
    icon: StickerGlyph,
    hidden: true,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('sticker');
      if (!util) return;
      const stickerId = useStyleStore.getState().stickerId;
      // `stickerId` addresses either the built-in catalog or the board's
      // uploaded library; a hit in the library wins and brings its artwork.
      const custom = useCustomStickersStore.getState().stickers[stickerId];
      const props: StickerProps = {
        ...(util.getDefaultProps() as StickerProps),
        sticker: stickerId,
        ...(custom
          ? {
              blobId: custom.blobId,
              ...customStickerSize(custom.width, custom.height),
            }
          : null),
      };
      const id = genId();
      ctx.editor.createShape({
        id,
        type: 'sticker',
        x: info.point.x - props.w / 2,
        y: info.point.y - props.h / 2,
        rotation: 0,
        opacity: 1,
        index: getTopIndex(ctx.editor.getShapes()),
        props,
      } as Shape);
      useStickerPopStore.getState().pop(id);
    },
  };
}
