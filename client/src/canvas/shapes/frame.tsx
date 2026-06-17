import type { ReactNode } from 'react';
import type { Shape } from '@whiteboard/shared';
import type { ShapeUtil } from './types';

/** World height of the title strip above the frame (also clickable). */
export const FRAME_TITLE_H = 20;

export const frameUtil: ShapeUtil<'frame'> = {
  type: 'frame',
  canResize: true,

  getDefaultProps: () => ({ w: 320, h: 240, name: 'Frame' }),

  getBounds: (s) => ({
    minX: s.x,
    minY: s.y,
    maxX: s.x + s.props.w,
    maxY: s.y + s.props.h,
  }),

  // Selectable on its interior (children sit above in z) and its title strip.
  hitTest: (s, p, tol) => {
    const inRect =
      p.x >= s.x - tol &&
      p.x <= s.x + s.props.w + tol &&
      p.y >= s.y - tol &&
      p.y <= s.y + s.props.h + tol;
    const inTitle =
      p.x >= s.x &&
      p.x <= s.x + s.props.w &&
      p.y >= s.y - FRAME_TITLE_H &&
      p.y <= s.y;
    return inRect || inTitle;
  },

  // Resizing a frame changes its window; children are revealed/clipped, not scaled.
  resize: (initial, nb) => ({
    x: nb.minX,
    y: nb.minY,
    props: {
      ...initial.props,
      w: Math.max(1, nb.maxX - nb.minX),
      h: Math.max(1, nb.maxY - nb.minY),
    },
  }),

  Component: ({ shape }) => <FrameChrome frame={shape} />,
};

/** The frame's own visuals: background, border, and title. */
export function FrameChrome({
  frame,
}: {
  frame: { x: number; y: number; props: { w: number; h: number; name: string } };
}) {
  const { x, y, props } = frame;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={props.w}
        height={props.h}
        fill="var(--color-card)"
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      <text
        x={x + 2}
        y={y - 6}
        fill="var(--color-muted-foreground)"
        fontSize={13}
        fontFamily="'Inter Variable', system-ui, sans-serif"
      >
        {props.name}
      </text>
    </g>
  );
}

/**
 * A frame plus its (already-rendered) children, clipped to the frame's
 * rectangle. The canvas supplies the children so content never spills outside
 * and nested frames recurse naturally.
 */
export function FrameView({
  frame,
  children,
}: {
  frame: Shape & { type: 'frame' };
  children: ReactNode;
}) {
  const clipId = `frame-clip-${frame.id}`;
  const { x, y, props } = frame;
  return (
    <g>
      <clipPath id={clipId}>
        <rect x={x} y={y} width={props.w} height={props.h} />
      </clipPath>
      {/* Background + border behind children. */}
      <rect
        x={x}
        y={y}
        width={props.w}
        height={props.h}
        fill="var(--color-card)"
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      <g clipPath={`url(#${clipId})`}>{children}</g>
      {/* Border on top so it stays crisp over clipped content. */}
      <rect
        x={x}
        y={y}
        width={props.w}
        height={props.h}
        fill="none"
        stroke="var(--color-border)"
        strokeWidth={1}
      />
      <text
        x={x + 2}
        y={y - 6}
        fill="var(--color-muted-foreground)"
        fontSize={13}
        fontFamily="'Inter Variable', system-ui, sans-serif"
      >
        {props.name}
      </text>
    </g>
  );
}
