import { Type } from 'lucide-react';
import { genId, type Shape, type TextProps } from '@whiteboard/shared';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { LINE_HEIGHT_FACTOR } from '../shapes/text-measure';
import { useCameraStore } from '../use-camera-store';
import { useStyleStore } from '../use-style-store';
import { useTextEditingStore } from '../use-text-editing-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

/**
 * Text tool. Clicking an existing text edits it; clicking empty space creates a
 * new text and immediately enters edit mode. Switches to select afterward so a
 * stray click doesn't spawn another text while the overlay is open.
 */
export function createTextTool(): Tool {
  return {
    id: 'text',
    label: 'Text',
    hotkey: 't',
    cursor: 'text',
    icon: Type,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const tol = 4 / useCameraStore.getState().camera.z;
      const shapes = ctx.editor.getShapes();

      // Edit the topmost text under the pointer, if any.
      for (let i = shapes.length - 1; i >= 0; i--) {
        const s = shapes[i]!;
        if (s.type !== 'text') continue;
        const util = shapeRegistry.getFor(s);
        if (util?.hitTest(s, info.point, tol)) {
          useTextEditingStore.getState().start(s.id);
          ctx.setTool('select');
          return;
        }
      }

      const util = shapeRegistry.get('text');
      if (!util) return;
      const style = useStyleStore.getState();
      const props = {
        ...(util.getDefaultProps() as TextProps),
        color: style.color,
        fontFamily: style.fontFamily,
        align: style.align,
      };
      const id = genId();
      const shape = {
        id,
        type: 'text',
        x: info.point.x,
        // Center the first line vertically on the click point.
        y: info.point.y - (props.fontSize * LINE_HEIGHT_FACTOR) / 2,
        rotation: 0,
        index: getTopIndex(shapes),
        props,
      } as Shape;
      ctx.editor.createShape(shape);
      useTextEditingStore.getState().start(id);
      ctx.setTool('select');
    },
  };
}
