import { blobUrl } from '../../board/blobs';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import type { ShapeUtil } from './types';

const IMAGE_CORNER_RADIUS = 12;
const IMAGE_SHADOW_BLUR = 4;
const IMAGE_SHADOW_DY = 3;
const IMAGE_SHADOW_MARGIN = 16;

export const imageUtil: ShapeUtil<'image'> = {
  type: 'image',
  canResize: true,

  getDefaultProps: () => ({
    blobId: '',
    w: 0,
    h: 0,
    naturalWidth: 0,
    naturalHeight: 0,
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
    const { blobId, w, h } = shape.props;
    if (!blobId) return null;
    const clipId = `image-clip-${shape.id}`;
    const shadowId = `image-shadow-${shape.id}`;
    const radius = Math.min(IMAGE_CORNER_RADIUS, w / 4, h / 4);
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
          <filter
            id={shadowId}
            x={shape.x - IMAGE_SHADOW_MARGIN}
            y={shape.y - IMAGE_SHADOW_MARGIN}
            width={w + IMAGE_SHADOW_MARGIN * 2}
            height={h + IMAGE_SHADOW_MARGIN * 2}
            filterUnits="userSpaceOnUse"
          >
            <feDropShadow
              dx={0}
              dy={IMAGE_SHADOW_DY}
              stdDeviation={IMAGE_SHADOW_BLUR}
              floodColor="#0f172a"
              floodOpacity={0.18}
            />
          </filter>
        </defs>
        <g filter={`url(#${shadowId})`}>
          <image
            href={blobUrl(blobId)}
            x={shape.x}
            y={shape.y}
            width={w}
            height={h}
            preserveAspectRatio="none"
            clipPath={`url(#${clipId})`}
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
