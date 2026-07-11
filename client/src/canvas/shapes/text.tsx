import { rotatePoint } from '@whiteboard/shared';
import type { Point, TextShape } from '@whiteboard/shared';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  LINE_HEIGHT_FACTOR,
  fontStack,
  layoutTextProps,
  textIndexAtPoint,
} from './text-measure';
import type { ShapeUtil } from './types';

export const DEFAULT_FONT_SIZE = 24;

/** Convert a world point into the unrotated text box's local coordinates. */
export function textWorldToLocal(shape: TextShape, point: Point): Point {
  const layout = layoutTextProps(shape.props);
  const center = {
    x: shape.x + layout.width / 2,
    y: shape.y + layout.height / 2,
  };
  const unrotated = shape.rotation
    ? rotatePoint(point, center, -shape.rotation)
    : point;
  return { x: unrotated.x - shape.x, y: unrotated.y - shape.y };
}

export function textIndexAtWorldPoint(shape: TextShape, point: Point): number {
  return textIndexAtPoint(layoutTextProps(shape.props), textWorldToLocal(shape, point));
}

export const textUtil: ShapeUtil<'text'> = {
  type: 'text',
  canResize: true,

  getDefaultProps: () => ({
    text: '',
    color: DEFAULT_SHAPE_STYLE.color,
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: 'sans',
    sizingMode: 'auto',
    width: 0,
    lineHeight: LINE_HEIGHT_FACTOR,
    align: 'start',
  }),

  getBounds: (shape) => {
    const layout = layoutTextProps(shape.props);
    return {
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + layout.width,
      maxY: shape.y + layout.height,
    };
  },

  hitTest: (shape, point, tolerance) => {
    const layout = layoutTextProps(shape.props);
    const local = textWorldToLocal(shape, point);
    return (
      local.x >= -tolerance &&
      local.x <= layout.width + tolerance &&
      local.y >= -tolerance &&
      local.y <= layout.height + tolerance
    );
  },

  // Corner handles scale typography and geometry together. Horizontal side
  // handles are intercepted by the selection tool and change only wrap width.
  resize: (initial, bounds) => {
    const layout = layoutTextProps(initial.props);
    const targetHeight = bounds.maxY - bounds.minY;
    const scale = layout.height > 0 ? targetHeight / layout.height : 1;
    const fixed = initial.props.sizingMode === 'fixed' || initial.props.width > 0;
    return {
      x: bounds.minX,
      y: bounds.minY,
      props: {
        ...initial.props,
        fontSize: Math.max(4, initial.props.fontSize * scale),
        width: fixed ? Math.max(8, initial.props.width * scale) : 0,
        sizingMode: fixed ? 'fixed' : 'auto',
      },
    };
  },

  Component: ({ shape }) => {
    const layout = layoutTextProps(shape.props);
    if (!shape.props.text) return null;
    const cx = shape.x + layout.width / 2;
    const cy = shape.y + layout.height / 2;
    const transform = shape.rotation
      ? `rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy})`
      : undefined;

    return (
      <text
        fill={shape.props.color}
        fontSize={shape.props.fontSize}
        fontFamily={fontStack(shape.props.fontFamily)}
        transform={transform}
        xmlSpace="preserve"
      >
        {layout.lines.map((line) => (
          <tspan
            key={`${line.start}:${line.end}:${line.y}`}
            x={shape.x + line.x}
            y={shape.y + line.baseline}
          >
            {line.text || ' '}
          </tspan>
        ))}
      </text>
    );
  },
};
