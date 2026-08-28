import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Music2,
  Pause,
  Play,
  RotateCcw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { MusicLibraryResponse, MusicTrack } from '@whiteboard/shared';
import { setMusicPlayback } from '@/canvas/use-document-store';
import type { Identity } from '@/collab/identity';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { CHROME_CONTROLS } from '@/components/ui/surface';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  // Attribution only when it isn't yours — the common case is you, and naming
  // yourself back is a line of text that tells nobody anything.
  const startedByPeer =
    currentTrack !== null &&
    playback.requestedBy !== undefined &&
    playback.requestedBy !== identity?.name;
  const triggerLabel = currentTrack ? `Music: ${currentTrack.title}` : 'Music';

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
    if (!currentTrack) return;
    const audio = audioRef.current;
    const position = audio?.currentTime ?? sharedPosition(playback);
    setMusicPlayback({
      status: isPlaying ? 'paused' : 'playing',
      position,
      requestedBy: publishRequester(),
    });
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
      {/* Trigger — playing takes the chrome's quiet pressed idiom (hairline +
          recessed fill); colour is reserved for status, and "playing" is an
          on/off state. As a toolbar item it carries its own `bg-surface` chip. */}
      <Popover>
        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              render={
                <PopoverTrigger
                  data-toolbar-item={toolbarItem || undefined}
                  tabIndex={toolbarItem ? -1 : undefined}
                  aria-label={triggerLabel}
                  aria-pressed={isPlaying}
                  className={cn(
                    buttonVariants({
                      variant: 'ghost',
                      size: showLabel ? 'sm' : 'icon-sm',
                    }),
                    toolbarItem && 'bg-surface',
                    isPlaying && 'border-border bg-panel text-fg',
                  )}
                />
              }
            >
              {isPlaying ? (
                <Volume2 aria-hidden="true" />
              ) : (
                <Music2 aria-hidden="true" />
              )}
              {showLabel ? <span>Music</span> : null}
            </TooltipTrigger>
            <TooltipContent side="bottom">{triggerLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* One flat surface, tiers held apart by gap alone — the same shell the
            other chrome popovers use. Nothing is shown disabled: with no track
            chosen the panel is just its library. */}
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={10}
          className={cn(
            CHROME_CONTROLS,
            'w-[min(20rem,calc(100vw-2rem))] gap-5 p-4',
          )}
        >
          <PopoverHeader className="flex-row items-center justify-between gap-3">
            <PopoverTitle>Music</PopoverTitle>
            {startedByPeer ? (
              <span className="min-w-0 truncate text-xs text-fg-muted">
                {playback.requestedBy}
              </span>
            ) : null}
          </PopoverHeader>

          {currentTrack ? (
            <div className="flex flex-col gap-3">
              <div className="min-w-0" aria-live="polite">
                <p className="truncate text-sm font-medium text-fg">
                  {currentTrack.title}
                </p>
                <p className="truncate text-xs text-fg-muted">
                  {trackSubtitle(currentTrack)}
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Slider
                  aria-label="Track position"
                  aria-valuetext={`${formatTime(timelineTime)} of ${
                    duration > 0 ? formatTime(duration) : 'unknown'
                  }`}
                  min={0}
                  max={duration > 0 ? duration : 1}
                  step={1}
                  value={duration > 0 ? timelineTime : 0}
                  disabled={duration <= 0}
                  onValueChange={(next) =>
                    setSeekPreview(Array.isArray(next) ? next[0]! : next)
                  }
                  onValueCommitted={seekTrack}
                />
                <div className="flex items-center justify-between font-mono text-xs tabular-nums text-fg-muted">
                  <span>{formatTime(timelineTime)}</span>
                  <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
                </div>
              </div>

              {/* Transport left, volume right — the fader is deliberately short
                  so it reads as secondary to the full-width timeline. */}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  onClick={togglePlayback}
                >
                  {isPlaying ? (
                    <Pause aria-hidden="true" />
                  ) : (
                    <Play aria-hidden="true" />
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Restart track"
                  onClick={restartTrack}
                >
                  <RotateCcw aria-hidden="true" />
                </Button>
                <div className="ml-auto flex w-36 items-center gap-1.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={muted ? 'Unmute' : 'Mute'}
                    onClick={toggleMute}
                  >
                    <VolumeIcon aria-hidden="true" />
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
                  />
                </div>
              </div>

              {/* The browser refused autoplay — unblocking is the one thing
                  that matters here, so it gets a full-width button. */}
              {audioBlocked ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9 w-full"
                  onClick={enableAudio}
                >
                  <Volume2 aria-hidden="true" />
                  Enable audio
                </Button>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            {library === null && !libraryError ? (
              <div
                role="status"
                aria-label="Loading music"
                className="flex flex-col gap-1"
              >
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
                <Skeleton className="h-9 w-full rounded-md" />
              </div>
            ) : libraryError ? (
              <LibraryNotice
                message="Couldn't load music"
                action="Try again"
                onAction={reloadLibrary}
              />
            ) : playlists.length === 0 ? (
              <LibraryNotice
                message="No tracks yet"
                action="Refresh"
                onAction={reloadLibrary}
              />
            ) : (
              <>
                {playlists.length > 1 ? (
                  <Tabs
                    value={activePlaylist ?? ''}
                    onValueChange={(value) => setActivePlaylist(String(value))}
                  >
                    <TabsList className="scrollbar-none w-full justify-start overflow-x-auto">
                      {playlists.map((playlist) => (
                        <TabsTrigger
                          key={playlist.name}
                          value={playlist.name}
                          className="flex-none"
                        >
                          {playlist.name}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                ) : null}

                <div
                  role="listbox"
                  aria-label={`Tracks in ${activePlaylist ?? 'library'}`}
                  className="scrollbar-none -mx-2 flex max-h-56 flex-col overflow-y-auto px-2"
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
                          'group/track flex h-9 shrink-0 items-center gap-2.5 rounded-md px-2 text-left',
                          'transition-colors duration-instant ease-out-quart',
                          'hover:bg-[var(--chrome-hover,var(--color-panel))]',
                          active && 'bg-panel',
                        )}
                      >
                        {/* Fixed glyph slot: the current track states itself,
                            the others only answer the cursor. */}
                        <span
                          aria-hidden="true"
                          className="flex size-3.5 shrink-0 items-center justify-center text-fg-muted"
                        >
                          {active && isPlaying ? (
                            <Pause className="size-3.5" />
                          ) : active ? (
                            <Play className="size-3.5" />
                          ) : (
                            <Play className="size-3.5 opacity-0 transition-opacity duration-instant group-hover/track:opacity-100" />
                          )}
                        </span>
                        <span
                          className={cn(
                            'min-w-0 flex-1 truncate text-sm',
                            active
                              ? 'font-medium text-fg'
                              : 'text-fg-secondary',
                          )}
                        >
                          {track.title}
                        </span>
                        {track.artist ? (
                          <span className="max-w-28 shrink-0 truncate text-xs text-fg-muted">
                            {track.artist}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </>
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

/** Loading failed or the folder is empty — one line, one way out. */
function LibraryNotice({
  message,
  action,
  onAction,
}: {
  message: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-6">
      <p className="text-sm text-fg-muted">{message}</p>
      <Button type="button" variant="outline" size="sm" onClick={onAction}>
        {action}
      </Button>
    </div>
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
  return track.artist ? `${track.artist} · ${track.playlist}` : track.playlist;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const remainder = String(whole % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}
