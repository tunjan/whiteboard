import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ListMusic,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import type { MusicLibraryResponse, MusicTrack } from '@whiteboard/shared';
import { setMusicPlayback } from '@/canvas/use-document-store';
import type { Identity } from '@/collab/identity';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useMusicPlaybackStore } from './use-music-playback-store';

interface MusicPlayerProps {
  identity: Identity | null;
}

export function MusicPlayer({ identity }: MusicPlayerProps) {
  const playback = useMusicPlaybackStore((s) => s.playback);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [library, setLibrary] = useState<MusicLibraryResponse | null>(null);
  const [libraryError, setLibraryError] = useState(false);
  const [activePlaylist, setActivePlaylist] = useState<string | null>(null);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [duration, setDuration] = useState(0);
  const [localTime, setLocalTime] = useState(0);

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
  }, []);

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
  const progress =
    duration > 0 ? Math.min(100, Math.max(0, (displayTime / duration) * 100)) : 0;

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

  function publishRequester() {
    return identity?.name ?? 'Someone';
  }

  function playTrack(track: MusicTrack) {
    setAudioBlocked(false);
    setDuration(0);
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

  function restartTrack() {
    if (!currentTrack) return;
    setAudioBlocked(false);
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

  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              variant={isPlaying ? 'outline' : 'ghost'}
              size="icon"
              aria-label="Music player"
              aria-pressed={isPlaying}
              className="size-8 rounded-lg"
            />
          }
        >
          {isPlaying ? <Volume2 /> : <Music2 />}
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={10}
          className="w-[min(22rem,calc(100vw-2rem))] gap-3 p-3"
        >
          <PopoverHeader>
            <PopoverTitle>Now playing</PopoverTitle>
            <PopoverDescription>
              {currentTrack
                ? trackSubtitle(currentTrack)
                : 'No song selected'}
            </PopoverDescription>
          </PopoverHeader>

          <div className="flex flex-col gap-2 rounded-lg bg-muted/45 p-2.5">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground">
                {isPlaying ? <Volume2 className="size-4" /> : <Music2 className="size-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">
                  {currentTrack?.title ?? 'Ready when you are'}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {currentTrack?.artist ?? currentTrack?.playlist ?? 'Choose a song'}
                </div>
              </div>
            </div>
            <div
              className="h-1.5 overflow-hidden rounded-full bg-background"
              aria-hidden="true"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] tabular-nums text-muted-foreground">
              <span>{formatTime(displayTime)}</span>
              <span>{duration > 0 ? formatTime(duration) : '--:--'}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                size="sm"
                onClick={togglePlayback}
                disabled={!currentTrack && playlists.length === 0}
              >
                {isPlaying ? <Pause data-icon="inline-start" /> : <Play data-icon="inline-start" />}
                {isPlaying ? 'Pause' : 'Play'}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Restart song"
                disabled={!currentTrack}
                onClick={restartTrack}
              >
                <RotateCcw />
              </Button>
              {playback.requestedBy ? (
                <span className="min-w-0 flex-1 truncate text-right text-[11px] text-muted-foreground">
                  by {playback.requestedBy}
                </span>
              ) : null}
            </div>
            {audioBlocked ? (
              <Button type="button" variant="outline" size="sm" onClick={enableAudio}>
                <Volume2 data-icon="inline-start" />
                Enable audio
              </Button>
            ) : null}
          </div>

          <Separator />

          {libraryError ? (
            <div className="rounded-lg bg-muted/45 p-3 text-sm text-muted-foreground">
              Music library unavailable.
            </div>
          ) : playlists.length === 0 ? (
            <div className="rounded-lg bg-muted/45 p-3 text-sm text-muted-foreground">
              No tracks found in the local music folder.
            </div>
          ) : (
            <>
              <div className="flex gap-1 overflow-x-auto pb-1">
                {playlists.map((playlist) => {
                  const active = playlist.name === activePlaylist;
                  return (
                    <Button
                      key={playlist.name}
                      type="button"
                      variant={active ? 'secondary' : 'ghost'}
                      size="sm"
                      aria-pressed={active}
                      onClick={() => setActivePlaylist(playlist.name)}
                      className="max-w-32 rounded-lg"
                    >
                      <ListMusic data-icon="inline-start" />
                      <span className="truncate">{playlist.name}</span>
                    </Button>
                  );
                })}
              </div>
              <div className="flex max-h-56 flex-col gap-1 overflow-y-auto pr-1">
                {activeTracks.map((track) => {
                  const active = track.id === currentTrack?.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => playTrack(track)}
                      className={cn(
                        'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2',
                        active ? 'bg-muted text-foreground' : 'hover:bg-muted/60',
                      )}
                    >
                      <Music2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {track.title}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {track.artist ?? track.playlist}
                        </span>
                      </span>
                      {active ? (
                        <Volume2 className="size-4 shrink-0 text-muted-foreground" />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </>
          )}
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
