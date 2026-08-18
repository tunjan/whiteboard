import { memo, useCallback, useEffect, useRef } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  Monitor,
  MonitorOff,
  PictureInPicture2,
  Video,
  VideoOff,
} from 'lucide-react';
import { useElementSize } from '@/canvas/use-element-size';
import { type Identity, textOnColor } from '@/collab/identity';
import { usePresenceStore } from '@/collab/use-presence-store';
import {
  useVideoStore,
  type VideoPanelMode,
} from '@/collab/voice/use-video-store';
import { useVoiceStore } from '@/collab/voice/use-voice-store';
import {
  disableCamera,
  disableScreen,
  enableCamera,
  enableScreen,
} from '@/collab/voice/video-session';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';
import {
  clampPanelPosition,
  LOCAL_CLIENT_ID,
  selfCameraTile,
  spotlightOrder,
  videoGridLayout,
  videoTiles,
  type VideoTile,
} from './video-panel-layout';

/** Kept clear of the canvas edges, and of the zoom controls it sits above. */
const DRAG_MARGIN = 12;

// Mirrors the ladder in CanvasControls, offset by that toolbar's own height
// (2.5rem, or 3.25rem once coarse-pointer targets grow it) plus a gap.
const ANCHOR =
  'right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(3.25rem+env(safe-area-inset-bottom))] max-sm:bottom-[calc(7.25rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(11rem+env(safe-area-inset-bottom))]';

const MODE_SIZE: Record<VideoPanelMode, string> = {
  bar: 'w-[min(18rem,calc(100vw-1.5rem))]',
  floating: 'w-[min(22rem,calc(100vw-1.5rem))]',
  maximized:
    'top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))]',
};

export const VideoPanel = memo(function VideoPanel({
  identity,
}: {
  identity: Identity | null;
}) {
  const status = useVoiceStore((state) => state.status);
  const cameraEnabled = useVideoStore((state) => state.cameraEnabled);
  const screenEnabled = useVideoStore((state) => state.screenEnabled);
  const error = useVideoStore((state) => state.error);
  const mode = useVideoStore((state) => state.mode);
  const position = useVideoStore((state) => state.position);
  const spotlightKey = useVideoStore((state) => state.spotlightKey);
  const selfView = useVideoStore((state) => state.selfView);
  const peers = usePresenceStore((state) => state.peers);
  const panelRef = useRef<HTMLDivElement>(null);
  const [gridRef, gridSize] = useElementSize<HTMLDivElement>();

  const maximized = mode === 'maximized';
  const collapsed = mode === 'bar';
  const dragging = !maximized;

  // Escape restores the board, matching the video overlay on the canvas.
  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') useVideoStore.getState().setMode('floating');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized]);

  // A window that shrinks under a dragged panel must not strand it off-screen.
  useEffect(() => {
    if (!position) return;
    const onResize = () => {
      const panel = panelRef.current;
      const current = useVideoStore.getState().position;
      if (!panel || !current) return;
      useVideoStore
        .getState()
        .setPosition(
          clampPanelPosition(
            current,
            { width: panel.offsetWidth, height: panel.offsetHeight },
            { width: window.innerWidth, height: window.innerHeight },
            DRAG_MARGIN,
          ),
        );
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [position]);

  const startDrag = useCallback(
    (event: React.PointerEvent) => {
      const panel = panelRef.current;
      // Let the buttons in the header keep their own clicks.
      if (!panel || event.button !== 0 || event.target !== event.currentTarget) {
        return;
      }
      event.stopPropagation();
      const rect = panel.getBoundingClientRect();
      const size = { width: rect.width, height: rect.height };
      const grabX = event.clientX - rect.left;
      const grabY = event.clientY - rect.top;

      const onMove = (moveEvent: PointerEvent) => {
        useVideoStore.getState().setPosition(
          clampPanelPosition(
            { x: moveEvent.clientX - grabX, y: moveEvent.clientY - grabY },
            size,
            { width: window.innerWidth, height: window.innerHeight },
            DRAG_MARGIN,
          ),
        );
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  if (!identity || status !== 'joined') return null;

  const local = {
    clientId: LOCAL_CLIENT_ID,
    name: identity.name,
    color: identity.color,
    camera: cameraEnabled,
    screen: screenEnabled,
  };
  const tiles = videoTiles({ local, peers });
  const selfTile = selfCameraTile(local, selfView);
  const { hero, filmstrip } = spotlightOrder(
    tiles,
    maximized ? spotlightKey : null,
  );
  const gridTiles = hero ? filmstrip : tiles;
  const { columns } = videoGridLayout(
    gridTiles.length,
    gridSize.height > 0 ? gridSize.width / gridSize.height : 0,
  );
  const viewCount = tiles.length + (selfTile ? 1 : 0);
  // Dragging replaces the edge anchor outright; until then the panel tracks the
  // zoom controls through their own breakpoints.
  const anchored = maximized || !position;

  return (
    <Surface
      ref={panelRef}
      mode="floating"
      chrome
      role="region"
      aria-label="Video call"
      className={cn(
        'absolute flex flex-col overflow-hidden',
        MODE_SIZE[mode],
        anchored && !maximized && ANCHOR,
      )}
      style={
        anchored ? undefined : { left: position.x, top: position.y }
      }
    >
      <header
        onPointerDown={dragging ? startDrag : undefined}
        className={cn(
          'flex items-center gap-1 border-border border-b p-1.5 pl-3',
          dragging && 'touch-none',
        )}
      >
        <span className="mr-auto truncate text-fg-muted text-sm">
          {viewCount === 0
            ? 'No video'
            : `${viewCount} ${viewCount === 1 ? 'view' : 'views'}`}
        </span>
        {cameraEnabled && !collapsed ? (
          <Toggle
            pressed={selfView === 'pip'}
            onPressedChange={(next) =>
              useVideoStore.getState().setSelfView(next ? 'pip' : 'hidden')
            }
            size="sm"
            className="min-w-8 px-1.5"
            aria-label={
              selfView === 'pip' ? 'Hide your own camera' : 'Show your own camera'
            }
          >
            <PictureInPicture2 aria-hidden="true" />
          </Toggle>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={collapsed ? 'Show video' : 'Collapse video'}
          onClick={() =>
            useVideoStore.getState().setMode(collapsed ? 'floating' : 'bar')
          }
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={maximized ? 'Restore video panel' : 'Maximize video panel'}
          onClick={() =>
            useVideoStore
              .getState()
              .setMode(maximized ? 'floating' : 'maximized')
          }
        >
          {maximized ? <Minimize2 /> : <Maximize2 />}
        </Button>
      </header>

      {collapsed ? null : (
        <>
          <div className="relative flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
            {hero ? (
              <VideoTileView
                tile={hero}
                spotlit
                onSpotlight={() =>
                  useVideoStore.getState().setSpotlightKey(null)
                }
              />
            ) : null}
            <div
              ref={gridRef}
              className={cn(
                'grid min-h-0 gap-1.5',
                hero ? 'h-24 shrink-0 grid-flow-col auto-cols-[8rem]' : 'flex-1',
              )}
              style={
                hero || columns === 0
                  ? undefined
                  : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }
              }
            >
              {gridTiles.map((tile) => (
                <VideoTileView
                  key={tile.key}
                  tile={tile}
                  spotlit={false}
                  onSpotlight={
                    maximized
                      ? () =>
                          useVideoStore.getState().setSpotlightKey(tile.key)
                      : undefined
                  }
                />
              ))}
              {gridTiles.length === 0 && !hero ? (
                <p className="self-center text-center text-fg-muted text-sm">
                  {selfTile
                    ? 'Waiting for someone else to turn on their camera.'
                    : 'Turn on your camera or share your screen to start.'}
                </p>
              ) : null}
            </div>
            {selfTile ? (
              <div
                className={cn(
                  'pointer-events-none absolute right-3 bottom-3 rounded-md border border-border shadow-e2',
                  maximized ? 'w-48' : 'w-28',
                )}
              >
                <VideoTileView
                  tile={selfTile}
                  spotlit={false}
                  className="aspect-video"
                />
              </div>
            ) : null}
          </div>

          <footer className="flex items-center gap-2.5 border-border border-t p-1.5">
            <Toggle
              pressed={cameraEnabled}
              onPressedChange={(next) =>
                next ? void enableCamera() : disableCamera()
              }
              variant="outline"
              size="sm"
              className="h-9 flex-1"
              aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
            >
              {cameraEnabled ? (
                <Video aria-hidden="true" data-icon="inline-start" />
              ) : (
                <VideoOff aria-hidden="true" data-icon="inline-start" />
              )}
              Camera
            </Toggle>
            <Toggle
              pressed={screenEnabled}
              onPressedChange={(next) =>
                next ? void enableScreen() : disableScreen()
              }
              variant="outline"
              size="sm"
              className="h-9 flex-1"
              aria-label={
                screenEnabled ? 'Stop sharing screen' : 'Share your screen'
              }
            >
              {screenEnabled ? (
                <Monitor aria-hidden="true" data-icon="inline-start" />
              ) : (
                <MonitorOff aria-hidden="true" data-icon="inline-start" />
              )}
              Screen
            </Toggle>
          </footer>
          {error ? (
            <p role="status" className="px-3 pb-2 text-danger-fg text-sm">
              {error}
            </p>
          ) : null}
        </>
      )}
    </Surface>
  );
});

function VideoTileView({
  tile,
  spotlit,
  onSpotlight,
  className,
}: {
  tile: VideoTile;
  spotlit: boolean;
  onSpotlight?: () => void;
  className?: string;
}) {
  const stream = useVideoStore((state) => streamFor(state, tile));
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream ?? null;
    return () => {
      video.srcObject = null;
    };
  }, [stream]);

  const label = (
    <span
      className="pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-0.5rem)] truncate rounded-xs px-1.5 py-0.5 text-xs"
      style={{ backgroundColor: tile.color, color: textOnColor(tile.color) }}
    >
      {tile.isLocal ? 'You' : tile.name}
      {tile.kind === 'screen' ? "'s screen" : ''}
    </span>
  );

  const body = (
    <>
      {/* Muted is not optional: call audio comes from the voice sinks, and an
          unmuted element would be blocked by the autoplay policy. */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={cn(
          'size-full',
          tile.isLocal && tile.kind === 'camera'
            ? 'object-cover'
            : 'object-contain',
          // A self camera reads as a mirror; a shared screen must not.
          tile.isLocal && tile.kind === 'camera' && '-scale-x-100',
        )}
      />
      {label}
    </>
  );

  const shell = cn(
    'relative min-h-0 overflow-hidden rounded-md bg-sunken',
    spotlit && 'flex-1',
    className,
  );

  if (!onSpotlight) {
    return <div className={shell}>{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onSpotlight}
      aria-label={
        spotlit
          ? 'Exit spotlight'
          : `Spotlight ${tile.isLocal ? 'your' : `${tile.name}'s`} ${tile.kind}`
      }
      className={shell}
    >
      {body}
    </button>
  );
}

function streamFor(
  state: {
    localCamera: MediaStream | null;
    localScreen: MediaStream | null;
    remoteCameras: Map<number, MediaStream>;
    remoteScreens: Map<number, MediaStream>;
  },
  tile: VideoTile,
): MediaStream | null {
  if (tile.isLocal) {
    return tile.kind === 'camera' ? state.localCamera : state.localScreen;
  }
  const remotes: Map<number, MediaStream> =
    tile.kind === 'camera' ? state.remoteCameras : state.remoteScreens;
  return remotes.get(tile.clientId) ?? null;
}
