import { genId, type Point, type Shape } from '@whiteboard/shared';
import { getTopIndex } from './order';
import { editor } from './use-document-store';

/** Default size (world units) for a freshly-placed video — 16:9. */
const DEFAULT_W = 480;
const DEFAULT_H = 270;

/**
 * Extract a YouTube video id from a watch / youtu.be / embed / shorts URL (or a
 * bare 11-char id). Returns null when the input isn't a recognizable YouTube
 * reference.
 */
export function parseYoutubeId(input: string): string | null {
  const text = input.trim();
  if (!text) return null;

  // Bare id.
  if (/^[A-Za-z0-9_-]{11}$/.test(text)) return text;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, '');
  const isYouTube =
    host === 'youtube.com' ||
    host === 'm.youtube.com' ||
    host === 'youtu.be' ||
    host === 'youtube-nocookie.com';
  if (!isYouTube) return null;

  let id: string | null = null;
  if (host === 'youtu.be') {
    id = url.pathname.slice(1);
  } else if (url.pathname === '/watch') {
    id = url.searchParams.get('v');
  } else {
    const m = url.pathname.match(/^\/(?:embed|shorts|v)\/([^/?]+)/);
    if (m) id = m[1] ?? null;
  }
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
}

/** Create a YouTube video shape centered at `at`, select it, return its id. */
export function createYoutubeShape(videoId: string, at: Point): string {
  const shape = {
    id: genId(),
    type: 'video',
    x: at.x - DEFAULT_W / 2,
    y: at.y - DEFAULT_H / 2,
    rotation: 0,
    index: getTopIndex(editor.getShapes()),
    props: { videoId, w: DEFAULT_W, h: DEFAULT_H },
  } as Shape;
  editor.createShape(shape);
  return shape.id;
}
