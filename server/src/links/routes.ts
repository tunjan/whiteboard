import { Hono } from 'hono';
import type { LinkUnfurl } from '@whiteboard/shared';
import { ALLOWED_MIME, saveBlob } from '../blobs/store';
import { BlockedHostError, fetchPublicUrl } from './fetch-remote';
import { parseLinkMeta } from './meta';
import { clientIp, rateLimiter } from '../rate-limit';
import { requireBoardEdit } from '../boards/access';

/**
 * Link unfurling for pasted URLs. The browser can't read a cross-origin page
 * itself, so the server fetches it, extracts preview metadata, and stores the
 * preview image in the same content-addressed blob store as pasted images —
 * which keeps third-party origins out of every viewer's browser and lets PNG
 * export inline the image like any other.
 *
 * Open like `/api/blobs` to anyone who may edit a board; the safety
 * here is in `fetch-remote.ts` (address and protocol restrictions) plus the
 * size, type and time caps below.
 */
export const linkRoutes = new Hono();

/** Enough for any real document head; sites that bury it deeper get no card. */
const MAX_HTML_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** How long an unfurl is reused before the page is fetched again. */
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

/** Each unfurl fetches up to three remote resources on the client's behalf. */
const unfurlLimit = rateLimiter(60, 60_000);

const cache = new Map<string, { value: LinkUnfurl; expires: number }>();
// Collapses the duplicate requests that arrive when several clients paste the
// same link, or one client pastes a list of near-identical URLs.
const inFlight = new Map<string, Promise<LinkUnfurl>>();

function cacheGet(url: string): LinkUnfurl | null {
  const hit = cache.get(url);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    cache.delete(url);
    return null;
  }
  return hit.value;
}

function cacheSet(url: string, value: LinkUnfurl): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { value, expires: Date.now() + CACHE_TTL_MS });
}

linkRoutes.get('/unfurl', requireBoardEdit, async (c) => {
  const url = c.req.query('url') ?? '';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.json({ error: 'Invalid url' }, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return c.json({ error: 'Unsupported protocol' }, 400);
  }

  const cached = cacheGet(url);
  if (cached) return c.json(cached);
  if (!unfurlLimit(clientIp(c))) return c.json({ error: 'Too many requests' }, 429);

  const pending = inFlight.get(url) ?? unfurl(url);
  inFlight.set(url, pending);
  try {
    const result = await pending;
    cacheSet(url, result);
    return c.json(result);
  } catch (error) {
    if (error instanceof BlockedHostError) {
      return c.json({ error: 'Blocked url' }, 403);
    }
    console.error('[links] unfurl failed', error);
    return c.json({ error: 'Unfurl failed' }, 502);
  } finally {
    inFlight.delete(url);
  }
});

/** Fetch a page and turn it into card metadata. */
async function unfurl(url: string): Promise<LinkUnfurl> {
  const page = await fetchPublicUrl(url, {
    accept: 'text/html,application/xhtml+xml',
    maxBytes: MAX_HTML_BYTES,
  });
  // A URL that isn't a readable HTML page (a PDF, an image, a dead host) still
  // gets a card — just one with nothing but its address on it.
  if (
    !page ||
    (page.contentType !== 'text/html' &&
      page.contentType !== 'application/xhtml+xml')
  ) {
    return { url };
  }

  const meta = parseLinkMeta(page.body.toString('utf8'), page.finalUrl);
  const [imageBlobId, faviconBlobId] = await Promise.all([
    storeRemoteImage(meta.image),
    storeRemoteImage(meta.favicon),
  ]);

  return {
    url,
    title: meta.title,
    description: meta.description,
    imageBlobId,
    faviconBlobId,
  };
}

/**
 * Download a preview image into the blob store, returning its id. Anything the
 * store doesn't accept (SVG, `.ico`, oversized art) is skipped rather than
 * failing the unfurl — the card renders fine without it.
 */
async function storeRemoteImage(
  imageUrl: string | undefined,
): Promise<string | undefined> {
  if (!imageUrl) return undefined;
  let image: Awaited<ReturnType<typeof fetchPublicUrl>>;
  try {
    image = await fetchPublicUrl(imageUrl, {
      accept: 'image/*',
      maxBytes: MAX_IMAGE_BYTES,
    });
  } catch {
    // A blocked asset host is not a reason to drop the rest of the card.
    return undefined;
  }
  if (!image || !ALLOWED_MIME[image.contentType] || image.body.byteLength === 0) {
    return undefined;
  }
  try {
    return await saveBlob(image.body, image.contentType);
  } catch (error) {
    console.error('[links] preview image store failed', error);
    return undefined;
  }
}
