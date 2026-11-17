import { genId, type Point, type Shape } from '@whiteboard/shared';
import {
  deleteLocalImageUrl,
  imageHref,
  setLocalImageUrl,
  uploadImageBlob,
} from '../board/blobs';
import { toast } from '@/components/ui/toast';
import { shortFileName } from '@/lib/utils';
import { getTopIndex, jitterKeyBetween } from './order';
import {
  currentSession,
  editor,
  updateShapeOnPage,
} from './use-document-store';

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

/**
 * Create a YouTube video shape centered at `at`, select it, return its id.
 * `index` is for a caller placing several shapes in one transaction, where
 * `getShapes()` is stale and the top has to be carried forward by hand.
 */
export function createYoutubeShape(
  videoId: string,
  at: Point,
  index = getTopIndex(editor.getShapes()),
): string {
  const shape = {
    id: genId(),
    type: 'video',
    x: at.x - DEFAULT_W / 2,
    y: at.y - DEFAULT_H / 2,
    rotation: 0,
    index,
    props: { videoId, w: DEFAULT_W, h: DEFAULT_H },
  } as Shape;
  editor.createShape(shape);
  return shape.id;
}

/** Video types the blob store accepts (mirrors the server's `VIDEO_MIME`). */
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime']);

/** Mirrors the server's `MAX_VIDEO_BYTES`. */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

/** Longest side (px) of the first-frame poster uploaded with a video. */
const POSTER_PX = 960;

export function isVideoFile(file: File): boolean {
  return VIDEO_TYPES.has(file.type);
}

interface VideoProbe {
  width: number;
  height: number;
  poster: Blob;
}

/**
 * Decode a video file far enough to read its size and grab a poster frame.
 * Null when this browser can't play it — the same browser its viewers use.
 */
function probeVideo(file: File): Promise<VideoProbe | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    const done = (probe: VideoProbe | null) => {
      video.onerror = video.onloadedmetadata = video.onseeked = null;
      video.onloadeddata = video.oncanplay = null;
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
      resolve(probe);
    };
    video.onerror = () => done(null);
    // A few frames in: frame 0 is black on anything that fades in.
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(0.1, (video.duration || 0) / 2);
    };
    const capture = () => {
      video.onloadeddata = video.oncanplay = null;
      const { videoWidth: width, videoHeight: height } = video;
      if (!width || !height) return done(null);
      const scale = Math.min(1, POSTER_PX / Math.max(width, height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (poster) => done(poster ? { width, height, poster } : null),
        'image/jpeg',
        0.85,
      );
    };
    // `seeked` can beat the decoded frame; drawn before it, the canvas stays
    // transparent and the JPEG poster comes out black.
    video.onseeked = () => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) capture();
      // `loadeddata` fires once per load, so it may already be spent.
      else video.onloadeddata = video.oncanplay = capture;
    };
    video.src = url;
  });
}

/**
 * Place pasted/dropped video files centered near `at` and return their ids.
 * Like `placeImageFiles`, the shapes appear at once for this client (poster
 * drawn from a local object URL) and the upload patches the blob ids in.
 */
export async function placeVideoFiles(
  files: File[],
  at: Point,
): Promise<string[]> {
  const fits = files.filter((f) => {
    if (f.size <= MAX_VIDEO_BYTES) return true;
    toast.add({
      title: shortFileName(f.name),
      description: 'Videos up to 100 MB can be added to the board.',
      type: 'error',
    });
    return false;
  });
  const probed = await Promise.all(fits.map(probeVideo));
  const ready: Array<{ file: File; probe: VideoProbe }> = [];
  fits.forEach((file, i) => {
    const probe = probed[i];
    if (probe) ready.push({ file, probe });
    else
      toast.add({
        title: shortFileName(file.name),
        description: 'This browser can’t play that video.',
        type: 'error',
      });
  });

  const ids: string[] = [];
  const pageId = currentSession()?.currentPageId;
  // One transaction: a multi-video paste is a single undo step. `getShapes()`
  // is stale inside it, so the top is taken once and carried forward.
  let index = getTopIndex(editor.getShapes());
  editor.transact(() => {
    let offset = 0;
    for (const { probe } of ready) {
      const scale = Math.min(1, DEFAULT_W / Math.max(probe.width, probe.height));
      const w = probe.width * scale;
      const h = probe.height * scale;
      const id = genId();
      // Registered before the shape exists so its first render already has it.
      setLocalImageUrl(id, URL.createObjectURL(probe.poster));
      editor.createShape({
        id,
        type: 'video',
        x: at.x - w / 2 + offset,
        y: at.y - h / 2 + offset,
        rotation: 0,
        index,
        props: { videoId: '', blobId: '', posterBlobId: '', w, h },
      } as Shape);
      ids.push(id);
      offset += 16;
      index = jitterKeyBetween(index, null);
    }
  });
  ready.forEach(({ file, probe }, i) => {
    if (pageId) void uploadPlacedVideo(pageId, ids[i]!, file, probe.poster);
  });
  return ids;
}

/** Upload a placed video and its poster, then patch the blob ids in. */
async function uploadPlacedVideo(
  pageId: string,
  id: string,
  file: File,
  poster: Blob,
): Promise<void> {
  const localUrl = imageHref(id, '')!;
  const progress = toast.add({
    title: shortFileName(file.name),
    description: 'Uploading video…',
    type: 'loading',
  });
  let blobId: string;
  let posterBlobId: string;
  try {
    [blobId, posterBlobId] = await Promise.all([
      uploadImageBlob(file, file.type),
      uploadImageBlob(poster, 'image/jpeg'),
    ]);
  } catch (error) {
    console.error('[video] upload failed', error);
    toast.update(progress, {
      description: 'The video could not be uploaded.',
      type: 'error',
    });
    deleteLocalImageUrl(id);
    URL.revokeObjectURL(localUrl);
    // Peers could never play it; remove the placeholder they're seeing.
    await updateShapeOnPage(pageId, id, () => null);
    return;
  }
  toast.update(progress, {
    description: 'Video added',
    timeout: 2_000,
    type: 'success',
  });
  // The poster's bytes are the ones just uploaded: keep showing them locally.
  setLocalImageUrl(posterBlobId, localUrl);
  deleteLocalImageUrl(id);
  // Outside undo history, as image uploads are: Ctrl+Z steps back over the
  // whole paste rather than peeling the upload off it first.
  await updateShapeOnPage(pageId, id, (shape) =>
    shape.type === 'video' && !shape.props.blobId
      ? { props: { blobId, posterBlobId } }
      : undefined,
  );
}
