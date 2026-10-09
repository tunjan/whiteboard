import {
  genId,
  unionBounds,
  type Bounds,
  type LinkUnfurl,
  type Point,
  type Shape,
} from '@whiteboard/shared';
import { boardHeaders } from '@/board/board-access';
import { isValidHttpUrl } from './link-url';
import { getTopIndex } from './order';
import { createYoutubeShape, parseYoutubeId } from './place-video';
import { shapeRotatedBounds } from './shape-bounds';
import {
  BOOKMARK_WIDTH,
  bookmarkHeight,
  BOOKMARK_LOADING_HEIGHT,
} from './shapes/bookmark';
import { editor, withoutUndo } from './use-document-store';

/**
 * Placing pasted links on the canvas, in two phases.
 *
 * Phase 1 is synchronous: a card exists the instant the paste happens, showing
 * the URL. Phase 2 fetches the page's preview metadata in the background and
 * patches it in. Splitting them is what keeps a paste from waiting on a network
 * round-trip to a site that may be slow or unreachable.
 */

/** Gap between cards when a paste carries several links. */
const CARD_GAP = 16;

/** Cards per row before a multi-link paste wraps, so a long list stays legible. */
const CARDS_PER_ROW = 4;

// Settled unfurls, so pasting the same link twice in a session shows a complete
// card immediately and skips phase 2 entirely. In-flight requests are shared so
// a paste of several URLs from one site doesn't fetch it repeatedly.
const unfurled = new Map<string, LinkUnfurl>();
const inFlight = new Map<string, Promise<LinkUnfurl>>();

/** Ask the server for a link's preview metadata. */
export async function unfurlLink(url: string): Promise<LinkUnfurl> {
  const res = await fetch(`/api/links/unfurl?url=${encodeURIComponent(url)}`, {
    credentials: 'include',
    headers: boardHeaders(),
  });
  if (!res.ok) throw new Error(`Unfurl failed (${res.status})`);
  return (await res.json()) as LinkUnfurl;
}

function requestUnfurl(url: string): Promise<LinkUnfurl> {
  const existing = inFlight.get(url);
  if (existing) return existing;
  const request = unfurlLink(url)
    .then((meta) => {
      unfurled.set(url, meta);
      return meta;
    })
    .finally(() => inFlight.delete(url));
  inFlight.set(url, request);
  return request;
}

/** Combined world bounds of the given shapes, or null when none exist. */
function unionShapeBounds(ids: readonly string[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    const b = shapeRotatedBounds(shape);
    bounds = bounds ? unionBounds(bounds, b) : b;
  }
  return bounds;
}

/** Card props for metadata that is already known. */
function readyProps(url: string, meta: LinkUnfurl) {
  return {
    url,
    w: BOOKMARK_WIDTH,
    h: bookmarkHeight(meta),
    status: 'ready' as const,
    title: meta.title,
    description: meta.description,
    imageBlobId: meta.imageBlobId,
    faviconBlobId: meta.faviconBlobId,
  };
}

/**
 * Create shapes for pasted URLs, centered as a group on `at`, and return their
 * ids. Links a media shape already handles (a YouTube video) become that shape;
 * everything else becomes a bookmark card whose metadata fills in afterwards.
 */
export function placeLinkUrls(urls: string[], at: Point): string[] {
  const links = urls.filter(isValidHttpUrl);
  if (links.length === 0) return [];

  const ids: string[] = [];
  const toHydrate: { id: string; url: string }[] = [];

  // One transaction: a multi-link paste is a single document update, a single
  // re-render, and — with the centering pass below — a single undo step.
  editor.transact(() => {
    // Lay the shapes out in a grid from the origin, then move the block as a
    // whole. Sizes differ per link (a video card is not a bookmark card), so
    // each step reads the shape's real bounds rather than assuming a width.
    let cursorX = 0;
    let rowTop = 0;
    let rowHeight = 0;
    let column = 0;
    for (const url of links) {
      const videoId = parseYoutubeId(url);
      let id: string;
      if (videoId) {
        id = createYoutubeShape(videoId, { x: 0, y: 0 });
      } else {
        const cached = unfurled.get(url);
        const shape = {
          id: genId(),
          type: 'bookmark',
          x: 0,
          y: 0,
          rotation: 0,
          index: getTopIndex(editor.getShapes()),
          props: cached
            ? readyProps(url, cached)
            : {
                url,
                w: BOOKMARK_WIDTH,
                h: BOOKMARK_LOADING_HEIGHT,
                status: 'loading' as const,
              },
        } as Shape;
        editor.createShape(shape);
        id = shape.id;
        if (!cached) toHydrate.push({ id, url });
      }

      ids.push(id);
      const shape = editor.getShape(id);
      if (!shape) continue;
      if (column === CARDS_PER_ROW) {
        rowTop += rowHeight + CARD_GAP;
        cursorX = 0;
        rowHeight = 0;
        column = 0;
      }
      const bounds = shapeRotatedBounds(shape);
      editor.updateShape(id, {
        x: shape.x + (cursorX - bounds.minX),
        y: shape.y + (rowTop - bounds.minY),
      });
      cursorX += bounds.maxX - bounds.minX + CARD_GAP;
      rowHeight = Math.max(rowHeight, bounds.maxY - bounds.minY);
      column++;
    }

    // Center the block's bounding box on the paste point. Cards are created
    // unrotated at the top level, so this is a plain translation.
    const blockBounds = unionShapeBounds(ids);
    if (!blockBounds) return;
    const dx = at.x - (blockBounds.minX + blockBounds.maxX) / 2;
    const dy = at.y - (blockBounds.minY + blockBounds.maxY) / 2;
    for (const id of ids) {
      const shape = editor.getShape(id);
      if (shape) editor.updateShape(id, { x: shape.x + dx, y: shape.y + dy });
    }
  });

  for (const { id, url } of toHydrate) void hydrateBookmark(id, url);
  return ids;
}

/**
 * Fetch a card's preview metadata and patch it into the shape.
 *
 * Written outside undo history: the user pasted a link, they didn't ask for a
 * network response, so Ctrl+Z should step back over the whole paste rather than
 * peeling the preview off it first. Peers still receive the update.
 */
async function hydrateBookmark(id: string, url: string): Promise<void> {
  let meta: LinkUnfurl;
  try {
    meta = await requestUnfurl(url);
  } catch (error) {
    console.error('[link] unfurl failed', error);
    // Settle the card anyway: a permanent placeholder reads as a broken paste,
    // whereas a plain URL card is a usable (if bare) link.
    meta = { url };
  }

  // The fetch was in flight for a while; make sure the shape it was for is
  // still there, still points at this URL, and hasn't been filled in already.
  const shape = editor.getShape(id);
  if (
    !shape ||
    shape.type !== 'bookmark' ||
    shape.props.url !== url ||
    shape.props.status !== 'loading'
  ) {
    return;
  }

  // Keep a card the user already resized; only a still-default one is re-fit to
  // the metadata that arrived.
  const untouched =
    shape.props.w === BOOKMARK_WIDTH &&
    shape.props.h === BOOKMARK_LOADING_HEIGHT;

  withoutUndo(() => {
    editor.updateShape(id, {
      props: {
        status: 'ready',
        title: meta.title,
        description: meta.description,
        imageBlobId: meta.imageBlobId,
        faviconBlobId: meta.faviconBlobId,
        ...(untouched ? { h: bookmarkHeight(meta) } : {}),
      },
    });
  });
}
