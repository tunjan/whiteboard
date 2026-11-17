import { useEffect, useSyncExternalStore } from 'react';
import { rotatePoint } from '@whiteboard/shared';
import type { Point, TextShape } from '@whiteboard/shared';
import {
  getEquationRender,
  requestEquationTypeset,
  subscribeEquationRender,
} from '../equation-render';
import { DEFAULT_SHAPE_STYLE } from './style';
import {
  DEFAULT_FONT_WEIGHT,
  LINE_HEIGHT_FACTOR,
  fontStack,
  fontWeight,
  layoutTextProps,
  scheduleTextMetricsInvalidation,
  subscribeToTextMetrics,
  textIndexAtPoint,
  textMetricsEpoch,
} from './text-measure';
import { isRichText, richTextLayout, textBoxSize } from './text-rich';
import type { ShapeUtil } from './types';

export const DEFAULT_FONT_SIZE = 24;

/** Convert a world point into the unrotated text box's local coordinates. */
export function textWorldToLocal(shape: TextShape, point: Point): Point {
  const box = textBoxSize(shape.props);
  const center = {
    x: shape.x + box.width / 2,
    y: shape.y + box.height / 2,
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
    fontWeight: DEFAULT_FONT_WEIGHT,
    sizingMode: 'auto',
    width: 0,
    lineHeight: LINE_HEIGHT_FACTOR,
    align: 'start',
  }),

  getBounds: (shape) => {
    const box = textBoxSize(shape.props);
    return {
      minX: shape.x,
      minY: shape.y,
      maxX: shape.x + box.width,
      maxY: shape.y + box.height,
    };
  },

  hitTest: (shape, point, tolerance) => {
    const box = textBoxSize(shape.props);
    const local = textWorldToLocal(shape, point);
    return (
      local.x >= -tolerance &&
      local.x <= box.width + tolerance &&
      local.y >= -tolerance &&
      local.y <= box.height + tolerance
    );
  },

  // Corner handles scale typography and geometry together. Horizontal side
  // handles are intercepted by the selection tool and change only wrap width.
  resize: (initial, bounds) => {
    const box = textBoxSize(initial.props);
    const targetHeight = bounds.maxY - bounds.minY;
    const scale = box.height > 0 ? targetHeight / box.height : 1;
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
    if (!shape.props.text) return null;
    if (isRichText(shape.props.text)) return <RichText shape={shape} />;
    const layout = layoutTextProps(shape.props);
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
        fontWeight={fontWeight(shape.props.fontWeight)}
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

/** Text that uses Markdown or math marks, drawn by the browser (`text-rich`). */
function RichText({ shape }: { shape: TextShape }) {
  // Fonts landing and formulas being typeset both re-measure the box; the
  // epoch is how this view hears about either.
  useSyncExternalStore(subscribeToTextMetrics, textMetricsEpoch, textMetricsEpoch);
  const layout = richTextLayout(shape.props)!;
  const { pendingMath } = layout;

  useEffect(() => {
    if (pendingMath.length === 0) return;
    // ponytail: a landed formula re-derives every shape's bounds (the font-load
    // path), not just this one's; add a per-shape refresh to the document store
    // if that shows up while a peer types math into a text box.
    // `inline` is the typesetting style, the opposite of display math.
    const unsubscribes = pendingMath.map(({ latex, display }) =>
      subscribeEquationRender(latex, !display, scheduleTextMetricsInvalidation),
    );
    for (const { latex, display } of pendingMath) {
      // Typeset between this render and the effect: nothing will notify.
      if (getEquationRender(latex, !display)) scheduleTextMetricsInvalidation();
      else requestEquationTypeset(latex, !display);
    }
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [pendingMath]);

  const cx = shape.x + layout.width / 2;
  const cy = shape.y + layout.height / 2;
  const rotate = shape.rotation
    ? `rotate(${(shape.rotation * 180) / Math.PI} ${cx} ${cy}) `
    : '';
  return (
    // MathJax paints with `currentColor`, so `color` reaches the formulas.
    // Families without an italic face slant instead; the app turns synthesis
    // off globally.
    <g
      transform={`${rotate}translate(${shape.x} ${shape.y})`}
      fill={shape.props.color}
      color={shape.props.color}
      style={{ fontSynthesis: 'style' }}
    >
      {layout.items.map((item, index) => {
        switch (item.kind) {
          case 'text':
            return (
              <text
                key={index}
                x={item.x}
                y={item.y}
                fontSize={item.size}
                fontFamily={fontStack(item.family)}
                fontWeight={item.weight}
                fontStyle={item.italic ? 'italic' : undefined}
                xmlSpace="preserve"
              >
                {item.text}
              </text>
            );
          case 'rule':
            return (
              <rect
                key={index}
                x={item.x}
                y={item.y - item.thickness / 2}
                width={item.width}
                height={item.thickness}
              />
            );
          case 'code':
            return (
              <rect
                key={index}
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                rx={item.height * 0.15}
                fillOpacity={0.12}
              />
            );
          case 'math':
            return (
              <svg
                key={index}
                x={item.x}
                y={item.y}
                width={item.width}
                height={item.height}
                overflow="visible"
                // Sanitized by `equation-convert`, as for equation shapes.
                dangerouslySetInnerHTML={{ __html: item.svg }}
              />
            );
        }
      })}
    </g>
  );
}
