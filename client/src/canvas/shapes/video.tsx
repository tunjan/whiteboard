import { useLodDetail } from '../lod';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import type { ShapeUtil } from './types';

const VIDEO_CORNER_RADIUS = 12;
const VIDEO_SHADOW_BLUR = 4;
const VIDEO_SHADOW_DY = 3;
const VIDEO_SHADOW_MARGIN = 16;

/** YouTube thumbnail URL for a video id. */
export function youtubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * A YouTube video shape. The canvas renders a static thumbnail + play button
 * (this is what PNG export rasterizes); double-clicking swaps it for an
 * interactive iframe overlay (see `VideoPlayerOverlay`).
 */
export const videoUtil: ShapeUtil<'video'> = {
  type: 'video',
  canResize: true,

  getDefaultProps: () => ({
    videoId: '',
    w: 0,
    h: 0,
  }),

  getBounds: (s) => boxBounds(s.x, s.y, s.props.w, s.props.h),

  hitTest: (s, p, tol) =>
    boxHitTest(s.x, s.y, s.props.w, s.props.h, s.rotation, p, tol),

  resize: (initial, nb) => ({
    x: nb.minX,
    y: nb.minY,
    props: {
      ...initial.props,
      w: Math.max(1, nb.maxX - nb.minX),
      h: Math.max(1, nb.maxY - nb.minY),
    },
  }),

  Component: ({ shape }) => {
    const { videoId, w, h } = shape.props;
    const detail = useLodDetail();
    if (!videoId) return null;
    const clipId = `video-clip-${shape.id}`;
    const shadowId = `video-shadow-${shape.id}`;
    const radius = Math.min(VIDEO_CORNER_RADIUS, w / 4, h / 4);
    const shadow = detail === 'high';
    // Centered play badge sized relative to the box.
    const cx = shape.x + w / 2;
    const cy = shape.y + h / 2;
    const badge = Math.max(12, Math.min(w, h) * 0.16);
    const tri = badge * 0.42;
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        <defs>
          <clipPath id={clipId}>
            <rect
              x={shape.x}
              y={shape.y}
              width={w}
              height={h}
              rx={radius}
              ry={radius}
            />
          </clipPath>
          {shadow && (
            <filter
              id={shadowId}
              x={shape.x - VIDEO_SHADOW_MARGIN}
              y={shape.y - VIDEO_SHADOW_MARGIN}
              width={w + VIDEO_SHADOW_MARGIN * 2}
              height={h + VIDEO_SHADOW_MARGIN * 2}
              filterUnits="userSpaceOnUse"
            >
              <feDropShadow
                dx={0}
                dy={VIDEO_SHADOW_DY}
                stdDeviation={VIDEO_SHADOW_BLUR}
                floodColor="#0f172a"
                floodOpacity={0.18}
              />
            </filter>
          )}
        </defs>
        <g filter={shadow ? `url(#${shadowId})` : undefined} clipPath={`url(#${clipId})`}>
          <rect x={shape.x} y={shape.y} width={w} height={h} fill="#000000" />
          <image
            href={youtubeThumbnail(videoId)}
            x={shape.x}
            y={shape.y}
            width={w}
            height={h}
            preserveAspectRatio="xMidYMid slice"
          />
        </g>
        <g pointerEvents="none">
          <circle cx={cx} cy={cy} r={badge} fill="#000000" fillOpacity={0.55} />
          <path
            d={`M ${cx - tri * 0.5} ${cy - tri} L ${cx + tri} ${cy} L ${cx - tri * 0.5} ${cy + tri} Z`}
            fill="#ffffff"
          />
        </g>
        <rect
          x={shape.x}
          y={shape.y}
          width={w}
          height={h}
          rx={radius}
          ry={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeOpacity={0.75}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    );
  },
};
