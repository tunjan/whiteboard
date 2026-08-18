import type { BookmarkProps, LinkUnfurl } from '@whiteboard/shared';
import { blobUrl } from '../../board/blobs';
import { linkHostname } from '../link-url';
import { useLodDetail } from '../lod';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import { MEDIA_CORNER_RADIUS } from './style';
import { layoutText, measureTextWidth, TEXT_FONT_FAMILY } from './text-measure';
import type { ShapeUtil } from './types';

/** Width every pasted link card starts at. */
export const BOOKMARK_WIDTH = 300;

/**
 * Card heights, chosen from what the unfurl returned. A card is created at the
 * full height and shrinks if the metadata turns out to be thin, so the common
 * case (a site with a preview image) never visibly resizes.
 */
export const BOOKMARK_LOADING_HEIGHT = 320;
const BOOKMARK_TITLE_HEIGHT = 101;
const BOOKMARK_BARE_HEIGHT = 46;

/** The height a card should take for the metadata it ended up with. */
export function bookmarkHeight(meta: LinkUnfurl): number {
  if (meta.imageBlobId) return BOOKMARK_LOADING_HEIGHT;
  return meta.title ? BOOKMARK_TITLE_HEIGHT : BOOKMARK_BARE_HEIGHT;
}

const PADDING = 12;
const GAP = 6;
const FOOTER_HEIGHT = 16;
const TITLE_SIZE = 14;
const TITLE_LINE = TITLE_SIZE * 1.25;
const DESCRIPTION_SIZE = 11;
const DESCRIPTION_LINE = DESCRIPTION_SIZE * 1.35;
const FOOTER_SIZE = 11;
const MAX_TITLE_LINES = 2;
const MAX_DESCRIPTION_LINES = 2;
/** Below this the preview image is a sliver; the card drops it instead. */
const MIN_IMAGE_HEIGHT = 40;

const ELLIPSIS = '…';

/**
 * Wrap `text` to `width` and cut it to `maxLines`, ellipsizing the last line.
 *
 * SVG text has no overflow handling of its own, so the card measures and trims
 * the string itself using the same layout engine text shapes use.
 */
function clampLines(
  text: string,
  width: number,
  maxLines: number,
  fontSize: number,
  weight: 400 | 600,
): string[] {
  if (!text.trim() || width <= 0) return [];
  const layout = layoutText({
    text,
    fontSize,
    fontWeight: weight,
    sizingMode: 'fixed',
    width,
  });
  const lines = layout.lines.map((line) => line.text.trim());
  if (lines.length <= maxLines) return lines;

  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (
    last.length > 0 &&
    measureTextWidth(last + ELLIPSIS, fontSize, 'sans', weight) > width
  ) {
    last = last.slice(0, -1).trimEnd();
  }
  kept[maxLines - 1] = last + ELLIPSIS;
  return kept;
}

interface CardLayout {
  /**
   * Height of the band above the text: the preview image, or the placeholder
   * that stands in for it while the metadata is loading. 0 when there is no
   * room for either.
   */
  imageHeight: number;
  titleLines: string[];
  descriptionLines: string[];
  /** Top of each block, in world units relative to the shape's y. */
  titleTop: number;
  descriptionTop: number;
  footerTop: number;
  contentWidth: number;
}

/**
 * Lay the card out from its current size rather than from the height constants,
 * so a card the user resized still renders sensibly. Blocks stack upwards from
 * the bottom edge — footer, description, title — and whatever room is left over
 * becomes the image band.
 */
function cardLayout(props: BookmarkProps): CardLayout {
  const loading = props.status === 'loading';
  const contentWidth = Math.max(0, props.w - PADDING * 2);
  const titleLines = loading
    ? []
    : clampLines(props.title ?? '', contentWidth, MAX_TITLE_LINES, TITLE_SIZE, 600);
  const descriptionLines = loading
    ? []
    : clampLines(
        props.description ?? '',
        contentWidth,
        MAX_DESCRIPTION_LINES,
        DESCRIPTION_SIZE,
        400,
      );

  // The loading card reserves the space its two placeholder bars occupy, so the
  // real title can drop straight into it without the card jumping.
  const titleHeight = (loading ? MAX_TITLE_LINES : titleLines.length) * TITLE_LINE;
  const descriptionHeight = descriptionLines.length * DESCRIPTION_LINE;

  const footerTop = props.h - PADDING - FOOTER_HEIGHT;
  let top = footerTop;
  const descriptionTop = descriptionHeight
    ? (top -= GAP + descriptionHeight)
    : top;
  const titleTop = titleHeight ? (top -= GAP + titleHeight) : top;

  const available = top - PADDING;
  const imageHeight =
    (props.imageBlobId || loading) && available >= MIN_IMAGE_HEIGHT
      ? available
      : 0;

  return {
    imageHeight,
    titleLines,
    descriptionLines,
    titleTop,
    descriptionTop,
    footerTop,
    contentWidth,
  };
}

export const bookmarkUtil: ShapeUtil<'bookmark'> = {
  type: 'bookmark',
  canResize: true,

  getDefaultProps: () => ({
    url: '',
    w: BOOKMARK_WIDTH,
    h: BOOKMARK_LOADING_HEIGHT,
    status: 'loading',
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
    const props = shape.props;
    const { w, h } = props;
    const detail = useLodDetail();
    if (!props.url) return null;

    const host = linkHostname(props.url);
    const layout = cardLayout(props);
    const radius = Math.min(MEDIA_CORNER_RADIUS, w / 4, h / 4);
    const clipId = `bookmark-clip-${shape.id}`;
    const imageClipId = `bookmark-image-clip-${shape.id}`;
    const shadowId = `bookmark-shadow-${shape.id}`;
    const shadow = detail === 'high';
    const loading = props.status === 'loading';

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
          {layout.imageHeight > 0 && (
            <clipPath id={imageClipId}>
              {/* Square off the bottom corners: only the card's own top corners
                  are rounded, and the text sits directly under the image. */}
              <path
                d={`M ${shape.x} ${shape.y + layout.imageHeight}
                    L ${shape.x} ${shape.y + radius}
                    A ${radius} ${radius} 0 0 1 ${shape.x + radius} ${shape.y}
                    L ${shape.x + w - radius} ${shape.y}
                    A ${radius} ${radius} 0 0 1 ${shape.x + w} ${shape.y + radius}
                    L ${shape.x + w} ${shape.y + layout.imageHeight} Z`}
              />
            </clipPath>
          )}
          {shadow && (
            <filter
              id={shadowId}
              x={shape.x - 16}
              y={shape.y - 16}
              width={w + 32}
              height={h + 32}
              filterUnits="userSpaceOnUse"
            >
              <feDropShadow
                dx={0}
                dy={1}
                stdDeviation={1}
                floodColor="#000000"
                floodOpacity={0.08}
              />
            </filter>
          )}
        </defs>

        <g filter={shadow ? `url(#${shadowId})` : undefined}>
          <rect
            x={shape.x}
            y={shape.y}
            width={w}
            height={h}
            rx={radius}
            ry={radius}
            fill="var(--color-card)"
          />
        </g>

        {layout.imageHeight > 0 && (
          <g clipPath={`url(#${imageClipId})`}>
            <rect
              x={shape.x}
              y={shape.y}
              width={w}
              height={layout.imageHeight}
              fill="var(--color-muted)"
            />
            {props.imageBlobId && (
              <image
                href={blobUrl(props.imageBlobId)}
                x={shape.x}
                y={shape.y}
                width={w}
                height={layout.imageHeight}
                preserveAspectRatio="xMidYMid slice"
              />
            )}
          </g>
        )}

        <g clipPath={`url(#${clipId})`}>
          {loading ? (
            <LoadingLines
              x={shape.x + PADDING}
              y={shape.y + layout.titleTop}
              width={layout.contentWidth}
            />
          ) : (
            <>
              {layout.titleLines.map((line, i) => (
                <text
                  key={`t${i}`}
                  x={shape.x + PADDING}
                  y={shape.y + layout.titleTop + i * TITLE_LINE + TITLE_SIZE}
                  fill="var(--color-foreground)"
                  fontSize={TITLE_SIZE}
                  fontWeight={600}
                  fontFamily={TEXT_FONT_FAMILY}
                >
                  {line}
                </text>
              ))}
              {layout.descriptionLines.map((line, i) => (
                <text
                  key={`d${i}`}
                  x={shape.x + PADDING}
                  y={
                    shape.y +
                    layout.descriptionTop +
                    i * DESCRIPTION_LINE +
                    DESCRIPTION_SIZE
                  }
                  fill="var(--color-muted-foreground)"
                  fontSize={DESCRIPTION_SIZE}
                  fontFamily={TEXT_FONT_FAMILY}
                >
                  {line}
                </text>
              ))}
            </>
          )}

          <Favicon
            x={shape.x + PADDING}
            y={shape.y + layout.footerTop}
            host={host}
            blobId={props.faviconBlobId}
          />
          <text
            x={shape.x + PADDING + FOOTER_HEIGHT + 6}
            y={shape.y + layout.footerTop + FOOTER_HEIGHT - 4}
            fill="var(--color-muted-foreground)"
            fontSize={FOOTER_SIZE}
            fontFamily={TEXT_FONT_FAMILY}
          >
            {host}
          </text>
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
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      </g>
    );
  },
};

/** Placeholder bars shown while the preview metadata is still being fetched. */
function LoadingLines({
  x,
  y,
  width,
}: {
  x: number;
  y: number;
  width: number;
}) {
  return (
    <g fill="var(--color-muted)">
      <rect x={x} y={y + 3} width={width} height={9} rx={4} />
      <rect x={x} y={y + 19} width={width * 0.6} height={9} rx={4} />
    </g>
  );
}

/** The site's icon, or its initial when no usable icon was found. */
function Favicon({
  x,
  y,
  host,
  blobId,
}: {
  x: number;
  y: number;
  host: string;
  blobId: string | undefined;
}) {
  if (blobId) {
    return (
      <image
        href={blobUrl(blobId)}
        x={x}
        y={y}
        width={FOOTER_HEIGHT}
        height={FOOTER_HEIGHT}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  }
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={FOOTER_HEIGHT}
        height={FOOTER_HEIGHT}
        rx={4}
        fill="var(--color-muted)"
      />
      <text
        x={x + FOOTER_HEIGHT / 2}
        y={y + FOOTER_HEIGHT - 4.5}
        textAnchor="middle"
        fill="var(--color-muted-foreground)"
        fontSize={9}
        fontWeight={600}
        fontFamily={TEXT_FONT_FAMILY}
      >
        {(host[0] ?? '?').toUpperCase()}
      </text>
    </g>
  );
}
