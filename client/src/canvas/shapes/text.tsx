import { rotatePoint, type TextAlign } from '@whiteboard/shared';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  LINE_HEIGHT_FACTOR,
  fontStack,
  measureText,
} from './text-measure';
import type { ShapeUtil } from './types';

export const DEFAULT_FONT_SIZE = 24;

/** SVG text-anchor + the x within [x0, x0+width] for a given alignment. */
function anchorFor(align: TextAlign, x0: number, width: number) {
  if (align === 'middle') return { anchor: 'middle' as const, x: x0 + width / 2 };
  if (align === 'end') return { anchor: 'end' as const, x: x0 + width };
  return { anchor: 'start' as const, x: x0 };
}

export const textUtil: ShapeUtil<'text'> = {
  type: 'text',
  canResize: true,

  getDefaultProps: () => ({
    text: '',
    color: DEFAULT_SHAPE_STYLE.color,
    fontSize: DEFAULT_FONT_SIZE,
    fontFamily: 'sans',
    width: 0,
    align: 'start',
  }),

  getBounds: (s) => {
    const { width, height } = measureText(
      s.props.text,
      s.props.fontSize,
      s.props.fontFamily,
    );
    return { minX: s.x, minY: s.y, maxX: s.x + width, maxY: s.y + height };
  },

  hitTest: (s, p, tol) => {
    const { width, height } = measureText(
      s.props.text,
      s.props.fontSize,
      s.props.fontFamily,
    );
    const center = { x: s.x + width / 2, y: s.y + height / 2 };
    const wp = s.rotation ? rotatePoint(p, center, -s.rotation) : p;
    return (
      wp.x >= s.x - tol &&
      wp.x <= s.x + width + tol &&
      wp.y >= s.y - tol &&
      wp.y <= s.y + height + tol
    );
  },

  // Text scales by font size (height drives it; width follows the glyphs).
  resize: (initial, nb) => {
    const { height } = measureText(
      initial.props.text,
      initial.props.fontSize,
      initial.props.fontFamily,
    );
    const sy = height > 0 ? (nb.maxY - nb.minY) / height : 1;
    return {
      x: nb.minX,
      y: nb.minY,
      props: {
        ...initial.props,
        fontSize: Math.max(4, initial.props.fontSize * sy),
      },
    };
  },

  Component: ({ shape }) => {
    const { text, color, fontSize, fontFamily, align } = shape.props;
    if (!text) return null;
    const lines = text.split('\n');
    const { width, height } = measureText(text, fontSize, fontFamily);
    const { anchor, x } = anchorFor(align, shape.x, width);
    const cx = shape.x + width / 2;
    const cy = shape.y + height / 2;
    const rot = shape.rotation
      ? `rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy})`
      : undefined;
    return (
      <text
        x={x}
        y={shape.y}
        fill={color}
        fontSize={fontSize}
        fontFamily={fontStack(fontFamily)}
        textAnchor={anchor}
        dominantBaseline="hanging"
        transform={rot}
      >
        {lines.map((line, i) => (
          <tspan
            // eslint-disable-next-line react/no-array-index-key -- lines are positional
            key={i}
            x={x}
            dy={i === 0 ? 0 : fontSize * LINE_HEIGHT_FACTOR}
          >
            {line || ' '}
          </tspan>
        ))}
      </text>
    );
  },
};
