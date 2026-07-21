import { Sigma } from 'lucide-react';
import {
  genId,
  type EquationProps,
  type Shape,
} from '@whiteboard/shared';
import { ensureMathJax } from '../equation-render';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

export function createEquationTool(): Tool {
  return {
    id: 'equation',
    label: 'Equation',
    hotkey: 'm',
    cursor: 'crosshair',
    icon: Sigma,

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      const util = shapeRegistry.get('equation');
      if (!util) return;

      const props = util.getDefaultProps() as EquationProps;
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
      void ensureMathJax().catch(() => undefined);
      ctx.complete();
    },
  };
}
