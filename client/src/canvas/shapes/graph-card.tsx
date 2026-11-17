import type { ReactNode, Ref } from 'react';
import type { GraphShape } from '@whiteboard/shared';
import { useLodDetail } from '../lod';
import { rotationTransform } from './box-geometry';
import { PaintedShadow, roundedRectPath } from './painted-shadow';

const PLOT_PADDING = 16;
const GRAPH_CARD_RADIUS = 8;
const GRAPH_SHADOW_BLUR = 6;
const GRAPH_SHADOW_DY = 4;
const GRAPH_SHADOW_OPACITY = 0.08;

export function plotArea(shape: { x: number; y: number; props: { w: number; h: number } }) {
  const x = shape.x + PLOT_PADDING;
  const y = shape.y + PLOT_PADDING;
  const w = Math.max(1, shape.props.w - PLOT_PADDING * 2);
  const h = Math.max(1, shape.props.h - PLOT_PADDING * 2);
  return { x, y, w, h };
}

/**
 * The card a graph sits on, 2D or 3D: its shadow, face and plot well, the
 * plot drawn in as `children`, and the DEG mark over it.
 */
export function GraphCard({
  shape,
  ref,
  children,
}: {
  shape: GraphShape;
  ref?: Ref<SVGGElement>;
  children: ReactNode;
}) {
  const props = shape.props;
  const area = plotArea(shape);
  // Zoomed far out the card drop shadow is sub-pixel; skip it.
  const shadow = useLodDetail() === 'high';
  return (
    <g
      ref={ref}
      style={{ pointerEvents: 'auto' }}
      transform={rotationTransform(shape.x, shape.y, props.w, props.h, shape.rotation)}
    >
      {shadow && (
        <PaintedShadow
          d={roundedRectPath(shape.x, shape.y, props.w, props.h, GRAPH_CARD_RADIUS)}
          dy={GRAPH_SHADOW_DY}
          blur={GRAPH_SHADOW_BLUR}
          opacity={GRAPH_SHADOW_OPACITY}
        />
      )}
      <rect
        x={shape.x}
        y={shape.y}
        width={props.w}
        height={props.h}
        rx={GRAPH_CARD_RADIUS}
        fill="var(--color-card)"
        stroke="var(--color-border)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <rect
        x={area.x}
        y={area.y}
        width={area.w}
        height={area.h}
        rx={4}
        fill="var(--color-panel)"
        stroke="var(--color-border)"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {children}
      {/* Like a calculator's DEG: whoever reads the board can't see the
          panel, and sin(90) means something else in radians. */}
      {props.angleUnit === 'deg' ? (
        <text
          x={shape.x + props.w - PLOT_PADDING}
          y={shape.y + PLOT_PADDING - 4.5}
          textAnchor="end"
          fontSize={8.5}
          fontWeight={600}
          letterSpacing="0.08em"
          fill="var(--color-muted-foreground)"
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          DEG
        </text>
      ) : null}
    </g>
  );
}
