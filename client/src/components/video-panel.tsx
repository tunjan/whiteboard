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
import type { Identity } from '@/collab/identity';
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
  mainTileKey,
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
  bar: 'max-w-[calc(100vw-1.5rem)]',
  floating: 'w-[min(22rem,calc(100vw-1.5rem))]',
  maximized:
    'top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))]',
};

/**
 * The video *is* the panel, so the controls ride on top of it and stay out of
 * the way until asked for — on hover for mice, and always for touch and for
 * anyone tabbing through them.
 */
const REVEAL =
  'touch-reveal opacity-0 transition-opacity duration-instant group-hover/panel:opacity-100 group-focus-within/panel:opacity-100';

/**
 * Controls sitting directly on a frame, with no plate under them: white, and
 * legible over a bright frame through a shadow on the glyph itself. Only ever
 * applied over video — over the panel's own surface it would be invisible.
 */
const OVER_VIDEO =
  'text-white hover:bg-white/15 hover:text-white aria-pressed:bg-white/25 [&_svg]:drop-shadow-[0_1px_3px_rgb(0_0_0/0.7)]';

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

  const startDrag = useCallback((event: React.PointerEvent) => {
    const panel = panelRef.current;
    // Let the controls layered over the video keep their own presses.
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
  }, []);

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
  const viewCount = tiles.length + (selfTile ? 1 : 0);
  // Dragging replaces the edge anchor outright; until then the panel tracks the
  // zoom controls through their own breakpoints.
  const anchored = maximized || !position;
  // With a frame behind them the controls go white and hide until hovered;
  // with only the panel's own surface behind them they cannot do either.
  const overVideo = tiles.length > 0;
  const anchorStyle = anchored ? undefined : { left: position.x, top: position.y };

  if (collapsed) {
    return (
      <Surface
        ref={panelRef}
        mode="floating"
        shape="pill"
        chrome
        role="region"
        aria-label="Video call"
        className={cn(
          'absolute flex items-center gap-1 p-1 pl-3',
          MODE_SIZE.bar,
          anchored && ANCHOR,
        )}
        style={anchorStyle}
        onPointerDown={startDrag}
      >
        <span className="mr-1 truncate text-fg-muted text-sm">
          {viewCount === 0
            ? 'No video'
            : `${viewCount} ${viewCount === 1 ? 'view' : 'views'}`}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Show video"
          onClick={() => useVideoStore.getState().setMode('floating')}
        >
          <ChevronUp />
        </Button>
      </Surface>
    );
  }

  // Maximized keeps its grid — that is the view for seeing everyone. The
  // minimised panel gives its one tile to the view you picked.
  const heroKey = maximized ? spotlightKey : mainTileKey(tiles, spotlightKey);
  const { hero, filmstrip } = spotlightOrder(tiles, heroKey);
  const gridTiles = hero ? filmstrip : tiles;
  const { columns } = videoGridLayout(
    gridTiles.length,
    gridSize.height > 0 ? gridSize.width / gridSize.height : 0,
  );

  return (
    <Surface
      ref={panelRef}
      mode="floating"
      chrome
      role="region"
      aria-label="Video call"
      className={cn(
        'group/panel absolute flex flex-col overflow-hidden bg-sunken',
        MODE_SIZE[mode],
        anchored && !maximized && ANCHOR,
      )}
      style={anchorStyle}
    >
      {maximized ? (
        <div className="relative flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
          {hero ? (
            <VideoTileView
              tile={hero}
              spotlit
              onSpotlight={() => useVideoStore.getState().setSpotlightKey(null)}
            />
          ) : null}
          <div
            ref={gridRef}
            className={cn(
              'grid min-h-0 gap-1.5',
              hero ? 'h-24 shrink-0 auto-cols-[8rem] grid-flow-col' : 'flex-1',
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
                onSpotlight={() =>
                  useVideoStore.getState().setSpotlightKey(tile.key)
                }
              />
            ))}
          </div>
        </div>
      ) : hero ? (
        <VideoTileView
          tile={hero}
          spotlit={false}
          className="aspect-video w-full rounded-none"
        />
      ) : (
        <p className="flex aspect-video items-center justify-center px-6 text-center text-fg-muted text-sm">
          {selfTile
            ? 'Waiting for someone else to turn on their camera.'
            : 'Turn on your camera or share your screen to start.'}
        </p>
      )}

      {/* The whole surface is the drag handle now that there is no header. An
          empty layer, so a press on it is never a press on something else. */}
      {dragging ? (
        <div
          onPointerDown={startDrag}
          className="absolute inset-0 cursor-grab touch-none"
        />
      ) : null}

      {selfTile ? (
        <div
          className={cn(
            'pointer-events-none absolute right-2 bottom-2 overflow-hidden rounded-md border border-border shadow-e2',
            maximized ? 'w-48' : 'w-24',
          )}
        >
          <VideoTileView
            tile={selfTile}
            spotlit={false}
            className="aspect-video"
          />
        </div>
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2',
          // Nothing to reveal over when there is no video to cover.
          overVideo && REVEAL,
        )}
      >
        {/* Who the one tile belongs to, when more than one view is on offer. */}
        <div className="pointer-events-auto flex min-w-0 gap-1 overflow-x-auto">
          {maximized
            ? null
            : filmstrip.map((tile) => (
                <Button
                  key={tile.key}
                  type="button"
                  variant="ghost"
                  size="xs"
                  className={cn(
                    'shrink-0 rounded-full px-2',
                    overVideo && OVER_VIDEO,
                  )}
                  onClick={() =>
                    useVideoStore.getState().setSpotlightKey(tile.key)
                  }
                >
                  <TileName tile={tile} />
                </Button>
              ))}
        </div>

        {/* No plate: the frame shows through, and the controls carry their own
            shadow. Touch targets and icon weight come from the panel Surface,
            whose `chrome` rules reach every button inside it. */}
        <div className="pointer-events-auto flex shrink-0 items-center gap-0.5">
          <Toggle
            pressed={cameraEnabled}
            onPressedChange={(next) =>
              next ? void enableCamera() : disableCamera()
            }
            size="sm"
            className={cn('min-w-8 px-1.5', overVideo && OVER_VIDEO)}
            aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            {cameraEnabled ? (
              <Video aria-hidden="true" />
            ) : (
              <VideoOff aria-hidden="true" />
            )}
          </Toggle>
          <Toggle
            pressed={screenEnabled}
            onPressedChange={(next) =>
              next ? void enableScreen() : disableScreen()
            }
            size="sm"
            className={cn('min-w-8 px-1.5', overVideo && OVER_VIDEO)}
            aria-label={
              screenEnabled ? 'Stop sharing screen' : 'Share your screen'
            }
          >
            {screenEnabled ? (
              <Monitor aria-hidden="true" />
            ) : (
              <MonitorOff aria-hidden="true" />
            )}
          </Toggle>
          {cameraEnabled ? (
            <Toggle
              pressed={selfView === 'pip'}
              onPressedChange={(next) =>
                useVideoStore.getState().setSelfView(next ? 'pip' : 'hidden')
              }
              size="sm"
              className={cn('min-w-8 px-1.5', overVideo && OVER_VIDEO)}
              aria-label={
                selfView === 'pip'
                  ? 'Hide your own camera'
                  : 'Show your own camera'
              }
            >
              <PictureInPicture2 aria-hidden="true" />
            </Toggle>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(overVideo && OVER_VIDEO)}
            aria-label="Collapse video"
            onClick={() => useVideoStore.getState().setMode('bar')}
          >
            <ChevronDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(overVideo && OVER_VIDEO)}
            aria-label={maximized ? 'Restore video panel' : 'Maximize video panel'}
            onClick={() =>
              useVideoStore
                .getState()
                .setMode(maximized ? 'floating' : 'maximized')
            }
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </Button>
        </div>
      </div>

      {error ? (
        <p
          role="status"
          className="-translate-x-1/2 absolute bottom-2 left-1/2 max-w-[calc(100%-1rem)] rounded-full border border-danger-border bg-surface px-3 py-1 text-danger-fg text-sm"
        >
          {error}
        </p>
      ) : null}
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
    <span className="pointer-events-none absolute inset-x-2 bottom-1.5 flex items-center gap-1.5 text-white text-xs drop-shadow-[0_1px_3px_rgb(0_0_0/0.7)]">
      <TileName tile={tile} />
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

  // Black, not a themed surface: a letterboxed screen share pads with bars, and
  // white labels have to stay readable on them in either theme.
  const shell = cn(
    'relative min-h-0 overflow-hidden rounded-md bg-black',
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

/**
 * Who a view belongs to: their presence colour as a dot, and the name in the
 * same white-on-frame treatment as the controls. A filled chip in the identity
 * colour shouted over every tile; the dot carries the same signal quietly.
 */
function TileName({ tile }: { tile: VideoTile }) {
  return (
    <>
      <span
        aria-hidden="true"
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: tile.color }}
      />
      <span className="truncate">
        {tile.isLocal ? 'You' : tile.name}
        {tile.kind === 'screen' ? "'s screen" : ''}
      </span>
    </>
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
