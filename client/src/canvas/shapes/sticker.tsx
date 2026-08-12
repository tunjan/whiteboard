import { blobUrl } from '../../board/blobs';
import { useLodDetail } from '../lod';
import { useStickerPopStore } from '../use-sticker-pop-store';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { getSticker, StickerArt } from './sticker-catalog';
import type { ShapeUtil } from './types';

export const STICKER_DEFAULT_SIZE = 96;

/**
 * Stamp size for custom artwork: the source's aspect ratio fitted into the
 * square a built-in stamp occupies, so a wide sticker reads as wide rather than
 * being squashed into the default box.
 */
export function customStickerSize(
  width: number,
  height: number,
): { w: number; h: number } {
  const longest = Math.max(width, height);
  if (longest <= 0) return { w: STICKER_DEFAULT_SIZE, h: STICKER_DEFAULT_SIZE };
  const scale = STICKER_DEFAULT_SIZE / longest;
  return {
    w: Math.max(1, Math.round(width * scale)),
    h: Math.max(1, Math.round(height * scale)),
  };
}

const STICKER_SHADOW_BLUR = 1.5;
const STICKER_SHADOW_DY = 1.5;
const STICKER_SHADOW_MARGIN = 16;

export const stickerUtil: ShapeUtil<'sticker'> = {
  type: 'sticker',
  canResize: true,

  getDefaultProps: () => ({
    sticker: 'thumbs-up',
    w: STICKER_DEFAULT_SIZE,
    h: STICKER_DEFAULT_SIZE,
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
    const { sticker, blobId, w, h } = shape.props;
    const detail = useLodDetail();
    const popping = useStickerPopStore((s) => s.popping.has(shape.id));
    const shadowId = `sticker-shadow-${shape.id}`;
    // Zoomed far out the drop shadow is sub-pixel; skip it (and its filter).
    const shadow = detail === 'high';
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        {shadow && (
          <defs>
            <filter
              id={shadowId}
              x={shape.x - STICKER_SHADOW_MARGIN}
              y={shape.y - STICKER_SHADOW_MARGIN}
              width={w + STICKER_SHADOW_MARGIN * 2}
              height={h + STICKER_SHADOW_MARGIN * 2}
              filterUnits="userSpaceOnUse"
            >
              <feDropShadow
                dx={0}
                dy={STICKER_SHADOW_DY}
                stdDeviation={STICKER_SHADOW_BLUR}
                floodColor="#000000"
                floodOpacity={0.18}
              />
            </filter>
          </defs>
        )}
        {/* The pop scales this inner group about its own box, so it composes
            with the rotation transform on the parent instead of fighting it. */}
        <g
          className={popping ? 'sticker-pop' : undefined}
          filter={shadow ? `url(#${shadowId})` : undefined}
        >
          {blobId ? (
            // The upload was cut out before it was stored, so the drop shadow
            // above falls on the artwork's own silhouette, not on a box.
            <image
              href={blobUrl(blobId)}
              x={shape.x}
              y={shape.y}
              width={w}
              height={h}
              preserveAspectRatio="xMidYMid meet"
            />
          ) : (
            <StickerArt
              def={getSticker(sticker)}
              x={shape.x}
              y={shape.y}
              w={w}
              h={h}
            />
          )}
        </g>
      </g>
    );
  },
};
