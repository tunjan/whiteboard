import { useEffect, useState } from 'react';
import { imageHref } from '../../board/blobs';
import { useImageThumb, useLodDetail } from '../lod';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { mergedRectPath, useMergedCorners } from './image-merge';
import { PaintedShadow } from './painted-shadow';
import { MEDIA_CORNER_RADIUS } from './style';
import type { ShapeUtil } from './types';

const IMAGE_SHADOW_BLUR = 1;
const IMAGE_SHADOW_DY = 1;
const IMAGE_SHADOW_OPACITY = 0.08;

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
    const { blobId, thumbBlobId, w, h, crop } = shape.props;
    const detail = useLodDetail();
    const squared = useMergedCorners(shape);
    const thumb = useImageThumb(shape.props);
    const href = useLoadedHref(
      imageHref(shape.id, thumb && thumbBlobId ? thumbBlobId : blobId),
    );
    // With a crop, draw the full source scaled so the crop sub-rect fills the
    // box; the clipPath below keeps only the box region visible.
    const fullW = crop ? w / crop.w : w;
    const fullH = crop ? h / crop.h : h;
    const imgX = crop ? shape.x - crop.x * fullW : shape.x;
    const imgY = crop ? shape.y - crop.y * fullH : shape.y;
    const clipId = `image-clip-${shape.id}`;
    const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
    // Where a neighbouring image is flush against an edge, the corners on it are
    // squared so the pair reads as one block instead of leaving a notch.
    const outline = mergedRectPath(shape.x, shape.y, w, h, radius, squared);
    // Another client's paste whose upload hasn't landed yet: hold its place.
    if (!href) {
      return (
        <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
          <path
            d={outline}
            fill="var(--color-muted)"
            stroke="var(--color-border)"
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      );
    }
    // Zoomed far out the drop shadow is sub-pixel; skip it.
    const shadow = detail === 'high';
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        <defs>
          <clipPath id={clipId}>
            <path d={outline} />
          </clipPath>
        </defs>
        {shadow && (
          <PaintedShadow
            d={outline}
            dy={IMAGE_SHADOW_DY}
            blur={IMAGE_SHADOW_BLUR}
            opacity={IMAGE_SHADOW_OPACITY}
          />
        )}
        <image
          href={href}
          x={imgX}
          y={imgY}
          width={fullW}
          height={fullH}
          preserveAspectRatio="none"
          clipPath={`url(#${clipId})`}
        />
        <path
          d={outline}
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

/**
 * `href`, but a change of it only shows once the new source has loaded.
 *
 * Crossing the thumbnail threshold swaps one copy of the picture for another;
 * pointing the `<image>` straight at the new URL would blank it for the length
 * of the download. Until the new source is ready the previous one stays up.
 */
function useLoadedHref(href: string | null): string | null {
  const [shown, setShown] = useState(href);
  useEffect(() => {
    if (href === shown) return;
    if (!href || !shown) {
      setShown(href);
      return;
    }
    // `load`, not `decode()`: the decode promise can sit unresolved in a
    // backgrounded page, and a loaded source is decoded on first paint anyway.
    // A failed load still switches — holding the old copy forever would hide
    // the failure behind a picture that no longer matches the zoom.
    const next = new Image();
    const show = () => setShown(href);
    next.addEventListener('load', show);
    next.addEventListener('error', show);
    next.src = href;
    return () => {
      next.removeEventListener('load', show);
      next.removeEventListener('error', show);
    };
  }, [href, shown]);
  return shown;
}
