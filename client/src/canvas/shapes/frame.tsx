import type { ReactNode } from 'react';
import {
  type FrameShape,
  type Point,
  pointInPolygon,
} from '@whiteboard/shared';
import {
  FRAME_HEADING_FONT_SCREEN,
  FRAME_HEADING_HEIGHT_SCREEN,
  frameHeadingLayout,
  frameHeadingSideTransform,
  frameHeadingText,
} from '../frame-geometry';
import { rotationTransform, unrotatedPoint } from './box-geometry';
import { DEFAULT_SHAPE_STYLE } from './style';
import type { ShapeUtil } from './types';

/** Screen height of the title control; exported for legacy callers/tests. */
export const FRAME_TITLE_H = FRAME_HEADING_HEIGHT_SCREEN;

export const frameUtil: ShapeUtil<'frame'> = {
  type: 'frame',
  canResize: true,

  getDefaultProps: () => ({
    w: 320,
    h: 240,
    name: 'Frame',
    color: DEFAULT_SHAPE_STYLE.color,
  }),

  // The heading is deliberately excluded: alignment, snapping, selection and
  // export bounds all describe the structural viewport, not its caption.
  getBounds: (shape) => ({
    minX: shape.x,
    minY: shape.y,
    maxX: shape.x + shape.props.w,
    maxY: shape.y + shape.props.h,
  }),

  // Empty frame interiors are selectable. The zoom-1 heading polygon is also a
  // useful world-space fallback; at runtime a double-click anywhere in the body
  // can edit the title, so zoom-adaptive labels never become unreachable.
  hitTest: (shape, point, tolerance) => {
    const local = unrotatedPoint(
      shape.x,
      shape.y,
      shape.props.w,
      shape.props.h,
      shape.rotation,
      point,
    );
    const inBody =
      local.x >= shape.x - tolerance &&
      local.x <= shape.x + shape.props.w + tolerance &&
      local.y >= shape.y - tolerance &&
      local.y <= shape.y + shape.props.h + tolerance;
    if (inBody) return true;
    const heading = frameHeadingLayout(shape, 1);
    return pointInPolygon(point, heading.corners as Point[]);
  },

  // Resizing changes the viewport; the selection state machine decides whether
  // children follow the moving origin or stay pinned in crop-resize mode.
  resize: (initial, bounds) => ({
    x: bounds.minX,
    y: bounds.minY,
    props: {
      ...initial.props,
      w: Math.max(1, bounds.maxX - bounds.minX),
      h: Math.max(1, bounds.maxY - bounds.minY),
    },
  }),

  Component: ({ shape }) => <FrameChrome frame={shape} />,
};

function LocalFrameTransform({
  frame,
  children,
}: {
  frame: FrameShape;
  children: ReactNode;
}) {
  const rotation = frame.rotation
    ? `rotate(${(frame.rotation * 180) / Math.PI} ${frame.props.w / 2} ${frame.props.h / 2})`
    : undefined;
  return (
    <g transform={`translate(${frame.x} ${frame.y})`}>
      <g transform={rotation}>{children}</g>
    </g>
  );
}

function FrameBackground({ frame }: { frame: FrameShape }) {
  return (
    <LocalFrameTransform frame={frame}>
      <rect
        data-slot="frame-background"
        x={0}
        y={0}
        width={frame.props.w}
        height={frame.props.h}
        fill="var(--color-card)"
        fillOpacity={0.96}
      />
    </LocalFrameTransform>
  );
}

function FrameBorder({ frame }: { frame: FrameShape }) {
  return (
    <LocalFrameTransform frame={frame}>
      <rect
        data-slot="frame-border"
        x={0}
        y={0}
        width={frame.props.w}
        height={frame.props.h}
        fill="none"
        stroke={frame.props.color ?? 'var(--color-muted-foreground)'}
        strokeOpacity={0.68}
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
      />
    </LocalFrameTransform>
  );
}

function FrameHeading({ frame, zoom }: { frame: FrameShape; zoom: number }) {
  const safeZoom = Math.max(zoom, 0.001);
  const layout = frameHeadingLayout(frame, safeZoom);
  const sideTransform = frameHeadingSideTransform(
    layout.side,
    frame.props.w,
    frame.props.h,
  );
  return (
    <LocalFrameTransform frame={frame}>
      <g transform={sideTransform}>
        <rect
          data-slot="frame-heading-hit-area"
          x={layout.x}
          y={layout.y}
          width={layout.width}
          height={layout.height}
          fill="transparent"
        />
        <text
          data-slot="frame-heading"
          x={layout.x + 6 / safeZoom}
          y={layout.y + layout.height / 2}
          fill={frame.props.color ?? 'var(--color-muted-foreground)'}
          fontSize={FRAME_HEADING_FONT_SCREEN / safeZoom}
          fontFamily="'Inter Variable', system-ui, sans-serif"
          fontWeight={550}
          dominantBaseline="central"
          paintOrder="stroke"
          stroke="var(--color-background)"
          strokeWidth={3 / safeZoom}
          strokeLinejoin="round"
        >
          {frameHeadingText(frame.props.name, layout, safeZoom)}
        </text>
      </g>
    </LocalFrameTransform>
  );
}

/** The frame's own visuals when rendered outside a container tree. */
export function FrameChrome({
  frame,
  zoom = 1,
  showTitle = true,
  showBorder = true,
}: {
  frame: FrameShape;
  zoom?: number;
  showTitle?: boolean;
  showBorder?: boolean;
}) {
  return (
    <g data-slot="frame" data-frame-id={frame.id}>
      <FrameBackground frame={frame} />
      {showBorder && <FrameBorder frame={frame} />}
      {showTitle && <FrameHeading frame={frame} zoom={zoom} />}
    </g>
  );
}

/**
 * Frame background + clipped subtree + foreground chrome. Nested FrameViews
 * naturally intersect their SVG clip paths. Arrows are hoisted by the canvas
 * renderer and therefore intentionally never enter this clipped group.
 */
export function FrameView({
  frame,
  children,
  opacity = 1,
  zoom = 1,
  showTitle = true,
  showBorder = true,
}: {
  frame: FrameShape;
  children: ReactNode;
  /** Resolved opacity for frame chrome only; children already compound it. */
  opacity?: number;
  zoom?: number;
  showTitle?: boolean;
  showBorder?: boolean;
}) {
  const clipId = `frame-clip-${frame.id}`;
  const transform = rotationTransform(
    frame.x,
    frame.y,
    frame.props.w,
    frame.props.h,
    frame.rotation,
  );
  return (
    <g data-slot="frame" data-frame-id={frame.id}>
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.props.w}
            height={frame.props.h}
            transform={transform}
          />
        </clipPath>
      </defs>
      <g opacity={opacity}>
        <FrameBackground frame={frame} />
      </g>
      <g clipPath={`url(#${clipId})`}>{children}</g>
      <g opacity={opacity}>
        {showBorder && <FrameBorder frame={frame} />}
        {showTitle && <FrameHeading frame={frame} zoom={zoom} />}
      </g>
    </g>
  );
}
