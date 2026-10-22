import type { VideoShape } from '@whiteboard/shared';
import { imageHref } from '../../board/blobs';
import { useLodDetail } from '../lod';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { PaintedShadow, roundedRectPath } from './painted-shadow';
import { MEDIA_CORNER_RADIUS } from './style';
import type { ShapeUtil } from './types';

const VIDEO_SHADOW_BLUR = 1;
const VIDEO_SHADOW_DY = 1;
const VIDEO_SHADOW_OPACITY = 0.08;

/** YouTube thumbnail URL for a video id. */
export function youtubeThumbnail(videoId: string): string {
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

/**
 * The still a video shape shows at rest: YouTube's thumbnail, or an uploaded
 * file's first-frame poster. Null while a peer's poster upload is pending.
 */
export function videoPoster(shape: VideoShape): string | null {
  const { videoId, posterBlobId } = shape.props;
  if (videoId) return youtubeThumbnail(videoId);
  return imageHref(shape.id, posterBlobId ?? '');
}

/**
 * A YouTube or uploaded-file video shape. The canvas renders a static
 * thumbnail + play button (this is what PNG export rasterizes); double-clicking
 * swaps it for an interactive player overlay (see `VideoPlayerOverlay`).
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
    const { videoId, blobId, w, h } = shape.props;
    const detail = useLodDetail();
    if (!videoId && blobId === undefined) return null;
    const poster = videoPoster(shape);
    const clipId = `video-clip-${shape.id}`;
    const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
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
        </defs>
        {shadow && (
          <PaintedShadow
            d={roundedRectPath(shape.x, shape.y, w, h, radius)}
            dy={VIDEO_SHADOW_DY}
            blur={VIDEO_SHADOW_BLUR}
            opacity={VIDEO_SHADOW_OPACITY}
          />
        )}
        <g clipPath={`url(#${clipId})`}>
          <rect x={shape.x} y={shape.y} width={w} height={h} fill="#000000" />
          {poster && (
            <image
              href={poster}
              x={shape.x}
              y={shape.y}
              width={w}
              height={h}
              preserveAspectRatio="xMidYMid slice"
            />
          )}
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
