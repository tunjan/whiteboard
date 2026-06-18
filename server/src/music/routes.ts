import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { basename, extname, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import type { MusicLibraryResponse, MusicTrack } from '@whiteboard/shared';
import { env } from '../env';

const MUSIC_ROOT = resolve(env.musicDir);
const ROOT_PLAYLIST = 'Library';

const AUDIO_MIME: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.oga': 'audio/ogg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
};

export const musicRoutes = new Hono();

musicRoutes.get('/', async (c) => {
  const tracks = await listTracks();
  const byPlaylist = new Map<string, MusicTrack[]>();
  for (const track of tracks) {
    const playlist = byPlaylist.get(track.playlist) ?? [];
    playlist.push(track);
    byPlaylist.set(track.playlist, playlist);
  }

  const playlists = [...byPlaylist.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, playlistTracks]) => ({
      name,
      tracks: playlistTracks.sort((a, b) => a.title.localeCompare(b.title)),
    }));

  return c.json({ playlists } satisfies MusicLibraryResponse);
});

musicRoutes.get('/tracks/:id', async (c) => {
  const track = await resolveTrack(c.req.param('id'));
  if (!track) return c.json({ error: 'Not found' }, 404);

  const size = track.size;
  const range = c.req.header('range');
  const mime = mimeForPath(track.path);

  if (!range) {
    return fileResponse(track.path, 200, {
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Content-Length': String(size),
      'Content-Type': mime,
    });
  }

  const parsed = parseRange(range, size);
  if (!parsed) {
    return new Response(null, {
      status: 416,
      headers: {
        'Content-Range': `bytes */${size}`,
      },
    });
  }

  return fileResponse(track.path, 206, {
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=3600',
    'Content-Length': String(parsed.end - parsed.start + 1),
    'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
    'Content-Type': mime,
  }, parsed);
});

async function listTracks(): Promise<MusicTrack[]> {
  const files = await listAudioFiles(MUSIC_ROOT);
  return files.map((path) => {
    const rel = toPosix(relative(MUSIC_ROOT, path));
    const parts = rel.split('/');
    const filename = parts.at(-1) ?? rel;
    const playlist = parts.length > 1 ? (parts[0] ?? ROOT_PLAYLIST) : ROOT_PLAYLIST;
    const { artist, title } = trackLabel(filename);

    return {
      id: Buffer.from(rel, 'utf8').toString('base64url'),
      title,
      artist,
      playlist,
      url: `/api/music/tracks/${Buffer.from(rel, 'utf8').toString('base64url')}`,
    };
  });
}

async function listAudioFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const files = await Promise.all(
      entries
        .filter((entry) => !entry.name.startsWith('.'))
        .map(async (entry) => {
          const path = resolve(root, entry.name);
          if (entry.isDirectory()) return listAudioFiles(path);
          if (!entry.isFile() || !AUDIO_MIME[extname(entry.name).toLowerCase()]) {
            return [];
          }
          return [path];
        }),
    );
    return files.flat().sort((a, b) => a.localeCompare(b));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function resolveTrack(
  id: string,
): Promise<{ path: string; size: number } | null> {
  let rel: string;
  try {
    rel = Buffer.from(id, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  if (!rel || rel.startsWith('/') || rel.includes('..')) return null;
  if (!AUDIO_MIME[extname(rel).toLowerCase()]) return null;

  const path = resolve(MUSIC_ROOT, rel);
  if (path !== MUSIC_ROOT && !path.startsWith(`${MUSIC_ROOT}${sep}`)) return null;

  try {
    const info = await stat(path);
    if (!info.isFile()) return null;
    return { path, size: info.size };
  } catch {
    return null;
  }
}

function fileResponse(
  path: string,
  status: 200 | 206,
  headers: Record<string, string>,
  range?: { start: number; end: number },
): Response {
  const stream = createReadStream(path, range);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status,
    headers,
  });
}

function parseRange(
  header: string,
  size: number,
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return null;

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }

  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end >= size ||
    start > end
  ) {
    return null;
  }
  return { start, end };
}

function mimeForPath(path: string): string {
  return AUDIO_MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

function trackLabel(filename: string): { artist?: string; title: string } {
  const clean = basename(filename, extname(filename))
    .replace(/[_]+/g, ' ')
    .trim();
  const parts = clean.split(/\s+-\s+/);
  if (parts.length >= 2) {
    return {
      artist: parts[0]?.trim() || undefined,
      title: parts.slice(1).join(' - ').trim() || clean,
    };
  }
  return { title: clean || filename };
}
