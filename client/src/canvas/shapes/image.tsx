import { blobUrl } from '../../board/blobs';
import { useLodDetail } from '../lod';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { MEDIA_CORNER_RADIUS } from './style';
import type { ShapeUtil } from './types';

const IMAGE_SHADOW_BLUR = 1;
const IMAGE_SHADOW_DY = 1;
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
    const { blobId, w, h, crop } = shape.props;
    const detail = useLodDetail();
    if (!blobId) return null;
    // With a crop, draw the full source scaled so the crop sub-rect fills the
    // box; the clipPath below keeps only the box region visible.
    const fullW = crop ? w / crop.w : w;
    const fullH = crop ? h / crop.h : h;
    const imgX = crop ? shape.x - crop.x * fullW : shape.x;
    const imgY = crop ? shape.y - crop.y * fullH : shape.y;
    const clipId = `image-clip-${shape.id}`;
    const shadowId = `image-shadow-${shape.id}`;
    const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
    // Zoomed far out the drop shadow is sub-pixel; skip it (and its filter).
    const shadow = detail === 'high';
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
                floodColor="#000000"
                floodOpacity={0.08}
              />
            </filter>
          )}
        </defs>
        <g filter={shadow ? `url(#${shadowId})` : undefined}>
          <image
            href={blobUrl(blobId)}
            x={imgX}
            y={imgY}
            width={fullW}
            height={fullH}
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
          strokeOpacity={1}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    );
  },
};
