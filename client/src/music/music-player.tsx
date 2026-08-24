import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { MusicLibraryResponse, MusicTrack } from '@whiteboard/shared';
import { setMusicPlayback } from '@/canvas/use-document-store';
import type { Identity } from '@/collab/identity';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { cn } from '@/lib/utils';
import { useMusicPlaybackStore } from './use-music-playback-store';

interface MusicPlayerProps {
  identity: Identity | null;
  showLabel?: boolean;
  toolbarItem?: boolean;
}

// Volume is a per-user, device-local preference — it must not be synced with
// the shared playback state. Persisted so it survives reloads.
const VOLUME_STORAGE_KEY = 'whiteboard:music-volume';

function readStoredVolume(): number {
  if (typeof window === 'undefined') return 1;
  const raw = window.localStorage.getItem(VOLUME_STORAGE_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
}

export function MusicPlayer({
  identity,
  showLabel = false,
  toolbarItem = false,
}: MusicPlayerProps) {
  const playback = useMusicPlaybackStore((s) => s.playback);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [libraryRequest, setLibraryRequest] = useState(0);
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volume, setVolume] = useState(readStoredVolume);
  const lastNonZeroVolume = useRef(volume > 0 ? volume : 1);

  useEffect(() => {
    let cancelled = false;
    setLibraryError(false);
    void fetch('/api/music', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error(`Music library failed (${res.status})`);
        return res.json() as Promise<MusicLibraryResponse>;
      })
      .then((next) => {
        if (cancelled) return;
        setLibrary(next);
        setActivePlaylist((current) => {
          if (current && next.playlists.some((p) => p.name === current)) {
            return current;
          }
          return next.playlists[0]?.name ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setLibraryError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [libraryRequest]);

  const playlists = library?.playlists ?? [];
  const activeTracks =
    playlists.find((playlist) => playlist.name === activePlaylist)?.tracks ?? [];
  const tracksById = useMemo(() => {
    const tracks = new Map<string, MusicTrack>();
    for (const playlist of playlists) {
      for (const track of playlist.tracks) tracks.set(track.id, track);
    }
    return tracks;
  }, [playlists]);
  const currentTrack = playback.trackId
    ? tracksById.get(playback.trackId) ?? null
    : null;
  const isPlaying = playback.status === 'playing' && currentTrack !== null;
  const displayTime = isPlaying ? localTime : playback.position;
  const timelineTime = Math.min(
    duration || Number.POSITIVE_INFINITY,
    Math.max(0, seekPreview ?? displayTime),
  );

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack) {
      audio.pause();
      setAudioBlocked(false);
      setLocalTime(0);
      return;
    }

    let cancelled = false;
    const align = () => {
      if (cancelled) return;
      seekToSharedPosition(audio, playback);
      setLocalTime(audio.currentTime);
    };

    if (audio.readyState >= 1) align();
    else audio.addEventListener('loadedmetadata', align, { once: true });

    if (playback.status === 'playing') {
      void audio
        .play()
        .then(() => {
          if (!cancelled) setAudioBlocked(false);
        })
        .catch(() => {
          if (!cancelled) setAudioBlocked(true);
        });
    } else {
      audio.pause();
      setAudioBlocked(false);
    }

    return () => {
      cancelled = true;
      audio.removeEventListener('loadedmetadata', align);
    };
  }, [currentTrack, playback]);

  useEffect(() => {
    if (!currentTrack || playback.status !== 'playing') return;
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      if (!audio || audio.readyState < 1) return;
      const target = sharedPosition(playback);
      if (Math.abs(audio.currentTime - target) > 0.75) {
        seekToSharedPosition(audio, playback);
      }
      setLocalTime(audio.currentTime);
    }, 500);
    return () => window.clearInterval(timer);
  }, [currentTrack, playback]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    if (volume > 0) lastNonZeroVolume.current = volume;
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(volume));
  }, [volume, currentTrack]);

  const muted = volume === 0;
  const VolumeIcon = muted ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  function toggleMute() {
    setVolume(muted ? lastNonZeroVolume.current : 0);
  }

  function publishRequester() {
    return identity?.name ?? 'Someone';
  }

  function playTrack(track: MusicTrack) {
    setAudioBlocked(false);
    setDuration(0);
    setSeekPreview(null);
    setMusicPlayback({
      trackId: track.id,
      status: 'playing',
      position: 0,
      requestedBy: publishRequester(),
    });
  }

  function togglePlayback() {
    if (currentTrack) {
      const audio = audioRef.current;
      const position = audio?.currentTime ?? sharedPosition(playback);
      setMusicPlayback({
        status: isPlaying ? 'paused' : 'playing',
        position,
        requestedBy: publishRequester(),
      });
      return;
    }

    const firstTrack = activeTracks[0] ?? playlists[0]?.tracks[0];
    if (firstTrack) playTrack(firstTrack);
  }

  function selectTrack(track: MusicTrack) {
    if (track.id === currentTrack?.id) {
      togglePlayback();
      return;
    }
    playTrack(track);
  }

  function restartTrack() {
    if (!currentTrack) return;
    setAudioBlocked(false);
    setSeekPreview(null);
    setMusicPlayback({
      trackId: currentTrack.id,
      status: 'playing',
      position: 0,
      requestedBy: publishRequester(),
    });
  }

  function enableAudio() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    seekToSharedPosition(audio, playback);
    void audio
      .play()
      .then(() => setAudioBlocked(false))
      .catch(() => setAudioBlocked(true));
  }

  function seekTrack(next: number | readonly number[]) {
    if (!currentTrack || duration <= 0) return;
    const rawPosition = Array.isArray(next) ? next[0] : next;
    const position = Math.min(duration, Math.max(0, rawPosition ?? 0));
    const audio = audioRef.current;
    if (audio) audio.currentTime = position;
    setLocalTime(position);
    setSeekPreview(null);
    setMusicPlayback({ position });
  }

  function reloadLibrary() {
    setLibrary(null);
    setLibraryError(false);
    setLibraryRequest((request) => request + 1);
  }

  return (
    <>
      {/* ── Trigger ─────────────────────────────────────────────────────────
          Playing takes the chrome's pressed idiom (hairline + recessed fill)
          rather than a coloured one — colour is reserved for status (P1), and
          "currently playing" is an on/off state, not semantic status (§3.2 R4).
          As a toolbar item it carries its own `bg-surface` chip, since the
          session row no longer backs its controls as one shared panel; in the
          compact popover grid (`showLabel`) it stays flat, already on a card. */}
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size={showLabel ? 'sm' : 'icon-sm'}
              data-toolbar-item={toolbarItem || undefined}
              tabIndex={toolbarItem ? -1 : undefined}
              aria-label="Open music player"
              className={cn(
                'rounded-md border',
                toolbarItem && 'bg-surface',
                isPlaying && 'border-border bg-panel text-fg',
              )}
            />
          }
        >
          {isPlaying ? <Volume2 /> : <Music2 />}
          {showLabel ? <span>Music</span> : null}
        </PopoverTrigger>

        {/* ── Popover: compound-card layout (§12.6) ────────────────────────
            p-0 wrapper owns the border and radius; internal strips own their
            padding. Strips share the same padding-x so content stays on one
            vertical rule. */}
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={10}
          className={cn(CHROME_CONTROLS, 'w-80 max-w-[calc(100vw-1.5rem)] gap-0 overflow-hidden p-0')}
        >
          {/* ── Header strip ──────────────────────────────────────────────── */}
          <div className="flex items-start justify-between border-b border-border bg-panel px-4 py-3">
            <div>
              {/* Eyebrow label — the system's signature section marker (§5.3) */}
              <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                Music
              </span>
              <p className="mt-0.5 text-xs text-fg-muted">
                Playback is shared with everyone on this board
              </p>
            </div>
          </div>

          {/* ── Now playing strip ─────────────────────────────────────────── */}
          <div
            aria-label="Now playing"
            className="flex flex-col gap-3 border-b border-border bg-panel px-4 pt-3 pb-4"
          >
            {/* Track identity + controls */}
            <div className="flex items-center gap-3">
              {/* Thumbnail: small square with current state glyph */}
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-surface text-fg-muted shadow-xs">
                <Music2 size={16} strokeWidth={1.5} aria-hidden="true" />
              </div>

              {/* Title + subtitle */}
              <div className="min-w-0 flex-1" aria-live="polite">
                <p className="truncate text-sm font-medium text-fg">
                  {currentTrack?.title ?? 'Ready when you are'}
                </p>
                <p className="truncate text-xs text-fg-secondary">
                  {currentTrack
                    ? trackSubtitle(currentTrack)
                    : 'Choose a track below'}
                </p>
              </div>

              {/* Compact controls: restart + play/pause */}
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Restart track"
                  disabled={!currentTrack}
                  onClick={restartTrack}
                  className="rounded-md"
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  disabled={!currentTrack && playlists.length === 0}
                  onClick={togglePlayback}
                  className="rounded-md"
                >
                  {isPlaying ? (
                    <Pause size={14} strokeWidth={1.5} />
                  ) : (
                    <Play size={14} strokeWidth={1.5} />
                  )}
                </Button>
              </div>
            </div>

            {/* Timeline */}
            <div>
              <Slider
                aria-label="Track position"
                aria-valuetext={`${formatTime(timelineTime)} of ${
                  duration > 0 ? formatTime(duration) : 'unknown'
                }`}
                min={0}
                max={duration > 0 ? duration : 1}
                step={1}
                value={duration > 0 ? timelineTime : 0}
                disabled={!currentTrack || duration <= 0}
                onValueChange={(next) =>
                  setSeekPreview(Array.isArray(next) ? next[0]! : next)
                }
                onValueCommitted={seekTrack}
                className="-my-1.5 py-1.5"
              />
              {/* Mono tabular time readout (§5.4 numerals: always tabular) */}
              <div className="mt-1.5 flex items-center justify-between font-mono text-xs tabular-nums text-fg-muted">
                <span>{formatTime(timelineTime)}</span>
                <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
              </div>
            </div>

            {/* Volume row */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={muted ? 'Unmute' : 'Mute'}
                onClick={toggleMute}
                className="shrink-0 rounded-md"
              >
                <VolumeIcon size={14} strokeWidth={1.5} />
              </Button>
              <Slider
                aria-label="Volume"
                min={0}
                max={1}
                step={0.01}
                value={volume}
                onValueChange={(next) =>
                  setVolume(Array.isArray(next) ? next[0]! : next)
                }
                className="py-1.5"
              />
              <span className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-fg-muted">
                {Math.round(volume * 100)}%
              </span>
            </div>

            {/* Audio blocked — unblocking is a primary action here */}
            {audioBlocked && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={enableAudio}
                className="w-full rounded-lg"
              >
                <Volume2 data-icon="inline-start" size={14} strokeWidth={1.5} />
                Enable audio
              </Button>
            )}

            {/* Attribution — caption below the controls (§5.4 caption role) */}
            {playback.requestedBy && !audioBlocked && (
              <p className="text-xs text-fg-muted">
                Started by {playback.requestedBy}
              </p>
            )}
          </div>

          {/* ── Library section ───────────────────────────────────────────── */}
          <div className="flex flex-col gap-3 px-4 pt-3 pb-4">
            {/* Library eyebrow + track count */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-2xs font-medium uppercase tracking-[0.08em] text-fg-muted">
                Library
              </span>
              {library !== null && !libraryError && (
                <span className="font-mono text-xs tabular-nums text-fg-muted">
                  {activeTracks.length}{' '}
                  {activeTracks.length === 1 ? 'track' : 'tracks'}
                </span>
              )}
            </div>

            {/* Loading skeleton */}
            {library === null && !libraryError && (
              <div
                role="status"
                aria-label="Loading music library"
                className="flex flex-col gap-2"
              >
                <Skeleton className="h-8 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
                <Skeleton className="h-12 w-full rounded-lg" />
              </div>
            )}

            {/* Error state */}
            {libraryError && (
              <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-panel p-3">
                <div>
                  <p className="text-sm font-medium text-fg">
                    Couldn&apos;t load your music
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    Check your connection and try again.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reloadLibrary}
                  className="self-start rounded-lg"
                >
                  <RefreshCw data-icon="inline-start" size={14} strokeWidth={1.5} />
                  Try again
                </Button>
              </div>
            )}

            {/* Empty library state */}
            {library !== null && !libraryError && playlists.length === 0 && (
              <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-panel p-3">
                <div>
                  <p className="text-sm font-medium text-fg">
                    Your library is empty
                  </p>
                  <p className="mt-0.5 text-xs text-fg-secondary">
                    Add audio files to the local music folder, then refresh.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={reloadLibrary}
                  className="self-start rounded-lg"
                >
                  <RefreshCw data-icon="inline-start" size={14} strokeWidth={1.5} />
                  Refresh library
                </Button>
              </div>
            )}

            {/* Populated library */}
            {library !== null && !libraryError && playlists.length > 0 && (
              <div className="flex flex-col gap-2">
                {/* Playlist segmented control (§12.3) — only when multiple playlists.
                    Container rounded-lg (12 px) + p-1 (4 px) → inner rounded-md (8 px).
                    r_inner = 12 − 4 = 8 ✓ */}
                {playlists.length > 1 && (
                  <div
                    role="tablist"
                    aria-label="Playlists"
                    className="scrollbar-none flex gap-1 overflow-x-auto rounded-lg bg-panel p-1"
                  >
                    {playlists.map((playlist) => {
                      const active = playlist.name === activePlaylist;
                      return (
                        <button
                          key={playlist.name}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onClick={() => setActivePlaylist(playlist.name)}
                          className={cn(
                            'flex shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium',
                            'h-7 transition-[background-color,color,box-shadow] duration-[120ms] ease-[cubic-bezier(0.65,0,0.35,1)]',
                            active
                              ? 'bg-surface text-fg shadow-xs'
                              : 'text-fg-muted hover:text-fg-secondary',
                          )}
                        >
                          <ListMusic size={13} strokeWidth={1.5} aria-hidden="true" />
                          <span className="max-w-24 truncate">{playlist.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Track list — scrollable, max ~4 rows visible */}
                <div
                  role="listbox"
                  aria-label={`Tracks in ${activePlaylist ?? 'library'}`}
                  className="scrollbar-none flex max-h-52 flex-col gap-0.5 overflow-y-auto"
                >
                  {activeTracks.map((track) => {
                    const active = track.id === currentTrack?.id;
                    return (
                      <button
                        key={track.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        aria-label={
                          active
                            ? `${isPlaying ? 'Pause' : 'Play'} ${track.title}`
                            : `Play ${track.title}`
                        }
                        onClick={() => selectTrack(track)}
                        className={cn(
                          // Layout
                          'group flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
                          // Colour-only transition at 80 ms (§11.1 instant)
                          'transition-[background-color,box-shadow] duration-[80ms] ease-[cubic-bezier(0.2,0,0,1)]',
                          // Active = lifted chip; inactive = ghost
                          active
                            ? 'bg-surface shadow-xs'
                            : 'hover:bg-panel',
                        )}
                      >
                        {/* State glyph in thumbnail slot — shows play/pause when active */}
                        <span
                          className={cn(
                            'flex size-8 shrink-0 items-center justify-center rounded-md',
                            'transition-colors duration-[80ms]',
                            active ? 'bg-panel text-fg' : 'bg-panel text-fg-muted',
                          )}
                          aria-hidden="true"
                        >
                          {active && isPlaying ? (
                            <Pause size={13} strokeWidth={1.5} />
                          ) : active ? (
                            <Play size={13} strokeWidth={1.5} />
                          ) : (
                            <Music2 size={13} strokeWidth={1.5} />
                          )}
                        </span>

                        {/* Track metadata */}
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block truncate text-sm',
                              active ? 'font-medium text-fg' : 'text-fg',
                            )}
                          >
                            {track.title}
                          </span>
                          <span className="block truncate text-xs text-fg-secondary">
                            {track.artist ?? track.playlist}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>

      <audio
        ref={audioRef}
        src={currentTrack?.url}
        preload="auto"
        onLoadedMetadata={(event) => {
          const audio = event.currentTarget;
          setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
          seekToSharedPosition(audio, playback);
          setLocalTime(audio.currentTime);
        }}
        onTimeUpdate={(event) => setLocalTime(event.currentTarget.currentTime)}
        onEnded={() => {
          setMusicPlayback({
            status: 'paused',
            position: 0,
            requestedBy: playback.requestedBy,
          });
        }}
      />
    </>
  );
}

function sharedPosition(playback: { status: string; position: number; updatedAt: number }) {
  if (playback.status !== 'playing') return playback.position;
  return Math.max(0, playback.position + (Date.now() - playback.updatedAt) / 1000);
}

function seekToSharedPosition(
  audio: HTMLAudioElement,
  playback: { status: string; position: number; updatedAt: number },
) {
  const target = sharedPosition(playback);
  const clamped =
    Number.isFinite(audio.duration) && audio.duration > 0
      ? Math.min(target, audio.duration)
      : target;
  if (Math.abs(audio.currentTime - clamped) > 0.35) {
    audio.currentTime = clamped;
  }
}

function trackSubtitle(track: MusicTrack): string {
  return track.artist ? `${track.artist} - ${track.playlist}` : track.playlist;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = String(whole % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}
