import { SigmaGlyph } from '@/components/ui/glyphs';
import {
  boundsCenter,
  genId,
  type EquationProps,
  type Point,
  type Shape,
} from '@whiteboard/shared';
import { requestEquationFocus } from '../equation-focus';
import { ensureEquationRenderer } from '../equation-render';
import { getTopIndex } from '../order';
import { shapeRegistry } from '../shapes/shape-registry';
import { useSelectionStore } from '../use-selection-store';
import { nextShapeStyle } from '../use-style-store';
import type { Tool, ToolContext, ToolPointerInfo } from './types';

function placeEquation(point: Point, ctx: ToolContext): void {
  const util = shapeRegistry.get('equation');
  if (!util) return;

  const props = {
    ...(util.getDefaultProps() as EquationProps),
    // Match every other tool: new shapes take the current drawing color.
    color: nextShapeStyle().color,
  };
  const id = genId();
  const shape = {
    id,
    type: 'equation',
    x: point.x - props.w / 2,
    y: point.y - props.h / 2,
    rotation: 0,
    index: getTopIndex(ctx.editor.getShapes()),
    props,
  } as Shape;

  ctx.editor.createShape(shape);
  useSelectionStore.getState().setSelection([id]);
  requestEquationFocus(id);
  void ensureEquationRenderer().catch(() => undefined);
  ctx.complete();
}

export function createEquationTool(): Tool {
  return {
    id: 'equation',
    label: 'Equation',
    hotkey: 'm',
    cursor: 'crosshair',
    icon: SigmaGlyph,

    // Start the (lazy, sizeable) MathJax load when the tool is picked, so the
    // renderer is usually warm by the time the first equation is placed.
    onEnter() {
      void ensureEquationRenderer().catch(() => undefined);
    },

    onPointerDown(info: ToolPointerInfo, ctx: ToolContext) {
      if (info.button !== 0) return;
      placeEquation(info.point, ctx);
    },

    onKeyDown(event: KeyboardEvent, ctx: ToolContext) {
      if (
        event.key !== 'Enter' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      ) {
        return false;
      }
      const bounds = ctx.getViewportBounds?.();
      if (!bounds) return false;
      event.preventDefault();
      placeEquation(boundsCenter(bounds), ctx);
      return true;
    },
  };
}
