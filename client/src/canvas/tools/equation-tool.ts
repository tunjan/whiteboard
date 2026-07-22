import { Sigma } from 'lucide-react';
import {
  genId,
  type EquationProps,
  type Shape,
} from '@whiteboard/shared';
import { requestEquationFocus } from '../equation-focus';
import { ensureMathJax } from '../equation-render';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { useStyleStore } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

export function createEquationTool(): Tool {
  return {
    id: 'equation',
    label: 'Equation',
    hotkey: 'm',
    cursor: 'crosshair',
    icon: Sigma,

    // Start the (lazy, sizeable) MathJax load when the tool is picked, so the
    // renderer is usually warm by the time the first equation is placed.
    onEnter() {
      void ensureMathJax().catch(() => undefined);
    },

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('equation');
      if (!util) return;

      const props = {
        ...(util.getDefaultProps() as EquationProps),
        // Match every other tool: new shapes take the current drawing color.
        color: useStyleStore.getState().color,
      };
      const id = genId();
      const shape = {
        id,
        type: 'equation',
        x: info.point.x - props.w / 2,
        y: info.point.y - props.h / 2,
        rotation: 0,
        index: getTopIndex(ctx.editor.getShapes()),
        props,
      } as Shape;

      ctx.editor.createShape(shape);
      useSelectionStore.getState().setSelection([id]);
      requestEquationFocus(id);
      void ensureMathJax().catch(() => undefined);
      ctx.complete();
    },
  };
}
