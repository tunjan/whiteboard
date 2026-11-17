import {
  type EllipseProps,
  genId,
  type LineProps,
  type Point,
  type RectangleProps,
  type Shape,
} from '@whiteboard/shared';
import { screenToWorld } from './camera';
import { getTopIndex, jitterKeyBetween } from './order';
import { shapeRegistry } from './shapes/shape-registry';
import { useCameraStore } from './use-camera-store';
import { editor } from './use-document-store';
import { useSelectionStore } from './use-selection-store';
import { slotStyle } from './use-style-store';
import { useToolStore } from './use-tool-store';

/** A preset part before ids and z-order: geometry around the origin. */
type Part =
  | { type: 'ellipse'; x: number; y: number; props: Partial<EllipseProps> }
  | { type: 'rectangle'; x: number; y: number; props: Partial<RectangleProps> }
  | { type: 'line'; x: number; y: number; props: Partial<LineProps> };

function segment(a: Point, b: Point, dash: LineProps['dash'] = 'solid'): Part {
  return {
    type: 'line',
    x: a.x,
    y: a.y,
    props: {
      points: [
        { x: 0, y: 0 },
        { x: b.x - a.x, y: b.y - a.y },
      ],
      bend: 0,
      spline: 'linear',
      label: '',
      dash,
    },
  };
}

const UNIT_RADIUS = 160;
/** Every multiple of 30° and 45°, minus the four the axes already draw. */
const SPOKE_DEGREES = [30, 45, 60, 120, 135, 150, 210, 225, 240, 300, 315, 330];

/** Circle, axes, and dashed spokes at the special angles — no labels. */
export function unitCircleParts(r = UNIT_RADIUS): Part[] {
  const reach = r * 1.25;
  return [
    {
      type: 'ellipse',
      x: -r,
      y: -r,
      props: { w: 2 * r, h: 2 * r, fillStyle: 'none', dash: 'solid' },
    },
    segment({ x: -reach, y: 0 }, { x: reach, y: 0 }),
    segment({ x: 0, y: -reach }, { x: 0, y: reach }),
    // Screen y grows downward, so the angle is measured with -sin.
    ...SPOKE_DEGREES.map((deg) => {
      const t = (deg * Math.PI) / 180;
      return segment(
        { x: 0, y: 0 },
        { x: r * Math.cos(t), y: -r * Math.sin(t) },
        'dashed',
      );
    }),
  ];
}

const CELL_W = 120;
const CELL_H = 56;

/** An empty ruled table: an outer box and the rules between cells. */
export function gridParts(rows: number, cols: number): Part[] {
  const w = cols * CELL_W;
  const h = rows * CELL_H;
  const x0 = -w / 2;
  const y0 = -h / 2;
  const parts: Part[] = [
    {
      type: 'rectangle',
      x: x0,
      y: y0,
      props: { w, h, fillStyle: 'none', dash: 'solid' },
    },
  ];
  for (let i = 1; i < rows; i++) {
    const y = y0 + i * CELL_H;
    parts.push(segment({ x: x0, y }, { x: x0 + w, y }));
  }
  for (let j = 1; j < cols; j++) {
    const x = x0 + j * CELL_W;
    parts.push(segment({ x, y: y0 }, { x, y: y0 + h }));
  }
  return parts;
}

/**
 * Drop a preset at the centre of the view as one group, in the current colour
 * and stroke weight, and select it: one undo step, one object to move.
 */
export function placePreset(parts: Part[]): void {
  const center = screenToWorld(
    { x: window.innerWidth / 2, y: window.innerHeight / 2 },
    useCameraStore.getState().camera,
  );
  // Placed from a menu, with whatever tool in hand: a table is always a diagram.
  const style = slotStyle('diagram');
  const groupId = genId();
  let index = '';

  const children: Shape[] = parts.map((part, i) => {
    index = i ? jitterKeyBetween(index, null) : getTopIndex(editor.getShapes());
    return {
      id: genId(),
      type: part.type,
      parentId: groupId,
      x: center.x + part.x,
      y: center.y + part.y,
      rotation: 0,
      opacity: style.opacity,
      index,
      props: {
        ...shapeRegistry.get(part.type)?.getDefaultProps(),
        color: style.color,
        size: style.size,
        ...part.props,
      },
    } as Shape;
  });
  // Children carry world coordinates; the group's box is derived from them.
  const group = {
    id: groupId,
    type: 'group',
    x: 0,
    y: 0,
    rotation: 0,
    index: jitterKeyBetween(index, null),
    props: {},
  } as Shape;

  editor.transact(() => {
    editor.createShape(group);
    for (const child of children) editor.createShape(child);
  });
  useToolStore.getState().setTool('select');
  useSelectionStore.getState().setSelection([groupId]);
}
