import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { ComponentType, SVGProps } from 'react';
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
import { HOVER_REVEAL, Surface } from '@/components/ui/surface';
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
const PANEL_EXIT_MS = 160;
const PANEL_MORPH_MS = 320;

// Mirrors the ladder in CanvasControls, offset by that toolbar's own height
// (2.5rem, or 3.25rem once coarse-pointer targets grow it) plus a gap.
const ANCHOR =
  'right-[max(0.75rem,env(safe-area-inset-right))] bottom-[calc(3.25rem+var(--wb-inset-bottom))] max-sm:bottom-[calc(7.25rem+var(--wb-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(11rem+var(--wb-inset-bottom))]';

const MODE_SIZE: Record<VideoPanelMode, string> = {
  bar: 'max-w-[calc(100vw-1.5rem)]',
  floating: 'w-[min(22rem,calc(100vw-1.5rem))]',
  maximized:
    'top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.75rem,env(safe-area-inset-left))]',
};

/**
 * Controls sitting directly on a frame, with no plate under them: white, and
 * legible over a bright frame through a shadow on the glyph itself. Only ever
 * applied over video — over the panel's own surface it would be invisible.
 */
const OVER_VIDEO =
  'text-white hover:bg-white/15 hover:text-white aria-pressed:bg-white/25 [&_svg]:drop-shadow-[0_1px_3px_rgb(0_0_0/0.7)]';

const VIDEO_CONTROL_MOTION =
  'relative transition-[color,background-color,border-color,opacity,scale] duration-fast ease-out-quart active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100';

interface DocumentViewTransition {
  finished: Promise<void>;
  skipTransition(): void;
}

type DocumentWithViewTransitions = Document & {
  startViewTransition?: (update: () => void) => DocumentViewTransition;
};

function captureTileRects(root: HTMLElement | null): Map<string, DOMRect> {
  const rects = new Map<string, DOMRect>();
  root
    ?.querySelectorAll<HTMLElement>('[data-video-tile-key]')
    .forEach((element) => {
      const key = element.dataset.videoTileKey;
      if (key) rects.set(key, element.getBoundingClientRect());
    });
  return rects;
}

function reducedMotionPreferred(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Keep a departing value mounted just long enough for its exit transition. */
function useExitPresence<T>(value: T | null, duration: number) {
  const latest = useRef(value);
  if (value !== null) latest.current = value;

  const present = value !== null;
  const [mounted, setMounted] = useState(present);
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    if (present) {
      setMounted(true);
      setExiting(false);
      return;
    }
    if (!mounted) return;

    setExiting(true);
    const timer = window.setTimeout(() => {
      setMounted(false);
      setExiting(false);
    }, duration);
    return () => window.clearTimeout(timer);
  }, [duration, mounted, present]);

  return {
    value: mounted ? latest.current : null,
    exiting,
  };
}

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
  const panelPresence = useExitPresence(
    identity && status === 'joined' ? identity : null,
    PANEL_EXIT_MS,
  );
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingPanelRect = useRef<DOMRect | null>(null);
  const pendingTileRects = useRef(new Map<string, DOMRect>());
  const panelAnimation = useRef<Animation | null>(null);
  const activeViewTransition = useRef<DocumentViewTransition | null>(null);
  const [gridRef, gridSize] = useElementSize<HTMLDivElement>();

  const maximized = mode === 'maximized';
  const collapsed = mode === 'bar';
  const dragging = !maximized;

  const runViewTransition = useCallback((update: () => void) => {
    const viewTransitionDocument = document as DocumentWithViewTransitions;
    if (
      reducedMotionPreferred() ||
      !viewTransitionDocument.startViewTransition
    ) {
      update();
      return false;
    }

    activeViewTransition.current?.skipTransition();
    const transition = viewTransitionDocument.startViewTransition(update);
    activeViewTransition.current = transition;
    void transition.finished
      .catch(() => undefined)
      .finally(() => {
        if (activeViewTransition.current === transition) {
          activeViewTransition.current = null;
        }
      });
    return true;
  }, []);

  const setPanelMode = useCallback(
    (nextMode: VideoPanelMode) => {
      if (useVideoStore.getState().mode === nextMode) return;
      const currentRect = panelRef.current?.getBoundingClientRect() ?? null;
      pendingPanelRect.current = currentRect;
      const usedViewTransition = runViewTransition(() =>
        useVideoStore.getState().setMode(nextMode),
      );
      if (usedViewTransition) pendingPanelRect.current = null;
    },
    [runViewTransition],
  );

  const setSpotlight = useCallback(
    (tileKey: string | null) => {
      if (useVideoStore.getState().spotlightKey === tileKey) return;
      const currentRects = captureTileRects(panelRef.current);
      pendingTileRects.current = currentRects;
      const usedViewTransition = runViewTransition(() =>
        useVideoStore.getState().setSpotlightKey(tileKey),
      );
      if (usedViewTransition) pendingTileRects.current = new Map();
    },
    [runViewTransition],
  );

  const setSelfView = useCallback(
    (nextSelfView: 'pip' | 'hidden') => {
      if (useVideoStore.getState().selfView === nextSelfView) return;
      runViewTransition(() =>
        useVideoStore.getState().setSelfView(nextSelfView),
      );
    },
    [runViewTransition],
  );

  // Safari and older Chromium builds do not have document view transitions.
  // A FLIP transform keeps mode changes spatially continuous there too.
  useLayoutEffect(() => {
    const panel = panelRef.current;
    const from = pendingPanelRect.current;
    pendingPanelRect.current = null;
    if (
      !panel ||
      !from ||
      reducedMotionPreferred() ||
      typeof panel.animate !== 'function'
    ) {
      return;
    }

    const to = panel.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    panelAnimation.current?.cancel();
    const animation = panel.animate(
      [
        {
          transformOrigin: 'top left',
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        {
          transformOrigin: 'top left',
          transform: 'translate(0, 0) scale(1, 1)',
        },
      ],
      {
        duration: PANEL_MORPH_MS,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    );
    panelAnimation.current = animation;
    animation.onfinish = () => {
      if (panelAnimation.current === animation) panelAnimation.current = null;
    };
  }, [mode]);

  // Spotlighting moves an existing tile between the grid and hero position.
  // Preserve that tile's trajectory when View Transitions are unavailable.
  useLayoutEffect(() => {
    const fromRects = pendingTileRects.current;
    pendingTileRects.current = new Map();
    if (fromRects.size === 0 || reducedMotionPreferred()) return;

    panelRef.current
      ?.querySelectorAll<HTMLElement>('[data-video-tile-key]')
      .forEach((element) => {
        const key = element.dataset.videoTileKey;
        const from = key ? fromRects.get(key) : undefined;
        if (!from || typeof element.animate !== 'function') return;
        const to = element.getBoundingClientRect();
        if (to.width === 0 || to.height === 0) return;
        element.animate(
          [
            {
              transformOrigin: 'top left',
              transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
            },
            {
              transformOrigin: 'top left',
              transform: 'translate(0, 0) scale(1, 1)',
            },
          ],
          {
            duration: PANEL_MORPH_MS,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
          },
        );
      });
  }, [spotlightKey]);

  // Escape restores the board, matching the video overlay on the canvas.
  useEffect(() => {
    if (!maximized) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPanelMode('floating');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [maximized, setPanelMode]);

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

  if (!panelPresence.value) return null;

  const local = {
    clientId: LOCAL_CLIENT_ID,
    name: panelPresence.value.name,
    color: panelPresence.value.color,
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
        data-video-panel-mode={mode}
        data-phase={panelPresence.exiting ? 'closing' : 'open'}
        role="region"
        aria-label="Video call"
        className={cn(
          'video-panel-motion absolute flex items-center gap-1 p-1 pl-3',
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
          className={VIDEO_CONTROL_MOTION}
          aria-label="Show video"
          onClick={() => setPanelMode('floating')}
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
      data-video-panel-mode={mode}
      data-phase={panelPresence.exiting ? 'closing' : 'open'}
      role="region"
      aria-label="Video call"
      className={cn(
        'video-panel-motion group/chrome absolute flex flex-col overflow-hidden bg-sunken',
        MODE_SIZE[mode],
        anchored && !maximized && ANCHOR,
      )}
      style={anchorStyle}
    >
      {maximized ? (
        <div className="video-panel-content relative flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
          {hero ? (
            <VideoTileView
              key={`hero:${hero.key}`}
              tile={hero}
              spotlit
              onSpotlight={() => setSpotlight(null)}
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
                onSpotlight={() => setSpotlight(tile.key)}
              />
            ))}
          </div>
        </div>
      ) : hero ? (
        <VideoTileView
          key={`floating:${hero.key}`}
          tile={hero}
          spotlit={false}
          className="aspect-video w-full rounded-none"
        />
      ) : (
        <p className="video-panel-content flex aspect-video items-center justify-center px-6 text-center text-fg-muted text-sm text-pretty">
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

      <SelfVideoPreview tile={selfTile} maximized={maximized} />

      <div
        className={cn(
          'pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2',
          // Nothing to reveal over when there is no video to cover.
          overVideo && HOVER_REVEAL,
          overVideo &&
            'translate-y-1 transition-[opacity,translate] duration-base ease-out-quart group-hover/chrome:translate-y-0 group-focus-within/chrome:translate-y-0 motion-reduce:translate-y-0 motion-reduce:transition-none [@media(pointer:coarse)]:translate-y-0',
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
                    VIDEO_CONTROL_MOTION,
                    overVideo && OVER_VIDEO,
                  )}
                  onClick={() => setSpotlight(tile.key)}
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
            className={cn(
              'min-w-8 px-1.5',
              VIDEO_CONTROL_MOTION,
              overVideo && OVER_VIDEO,
            )}
            aria-label={cameraEnabled ? 'Turn off camera' : 'Turn on camera'}
          >
            <CrossfadeIcon
              active={cameraEnabled}
              ActiveIcon={Video}
              InactiveIcon={VideoOff}
            />
          </Toggle>
          <Toggle
            pressed={screenEnabled}
            onPressedChange={(next) =>
              next ? void enableScreen() : disableScreen()
            }
            size="sm"
            className={cn(
              'min-w-8 px-1.5',
              VIDEO_CONTROL_MOTION,
              overVideo && OVER_VIDEO,
            )}
            aria-label={
              screenEnabled ? 'Stop sharing screen' : 'Share your screen'
            }
          >
            <CrossfadeIcon
              active={screenEnabled}
              ActiveIcon={Monitor}
              InactiveIcon={MonitorOff}
            />
          </Toggle>
          {cameraEnabled ? (
            <Toggle
              pressed={selfView === 'pip'}
              onPressedChange={(next) => setSelfView(next ? 'pip' : 'hidden')}
              size="sm"
              className={cn(
                'video-panel-control-in min-w-8 px-1.5',
                VIDEO_CONTROL_MOTION,
                overVideo && OVER_VIDEO,
              )}
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
            className={cn(VIDEO_CONTROL_MOTION, overVideo && OVER_VIDEO)}
            aria-label="Collapse video"
            onClick={() => setPanelMode('bar')}
          >
            <ChevronDown />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn(VIDEO_CONTROL_MOTION, overVideo && OVER_VIDEO)}
            aria-label={
              maximized ? 'Restore video panel' : 'Maximize video panel'
            }
            onClick={() => setPanelMode(maximized ? 'floating' : 'maximized')}
          >
            <CrossfadeIcon
              active={maximized}
              ActiveIcon={Minimize2}
              InactiveIcon={Maximize2}
            />
          </Button>
        </div>
      </div>

      <VideoError message={error} />
    </Surface>
  );
});

type PanelIcon = ComponentType<SVGProps<SVGSVGElement>>;

/** Both glyphs stay mounted so toggles confirm state without an icon pop. */
function CrossfadeIcon({
  active,
  ActiveIcon,
  InactiveIcon,
}: {
  active: boolean;
  ActiveIcon: PanelIcon;
  InactiveIcon: PanelIcon;
}) {
  const iconMotion =
    'transition-[opacity,scale,filter] duration-slow ease-out-quart motion-reduce:transition-none motion-reduce:blur-none';
  return (
    <>
      <ActiveIcon
        aria-hidden="true"
        className={cn(
          iconMotion,
          active
            ? 'scale-100 opacity-100 blur-none'
            : 'scale-25 opacity-0 blur-[4px]',
        )}
      />
      <InactiveIcon
        aria-hidden="true"
        className={cn(
          '-translate-x-1/2 -translate-y-1/2 absolute top-1/2 left-1/2',
          iconMotion,
          active
            ? 'scale-25 opacity-0 blur-[4px]'
            : 'scale-100 opacity-100 blur-none',
        )}
      />
    </>
  );
}

function SelfVideoPreview({
  tile,
  maximized,
}: {
  tile: VideoTile | null;
  maximized: boolean;
}) {
  const presence = useExitPresence(tile, PANEL_EXIT_MS);
  if (!presence.value) return null;

  return (
    <div
      data-phase={presence.exiting ? 'closing' : 'open'}
      className={cn(
        'video-self-preview pointer-events-none absolute right-2 bottom-2 overflow-hidden rounded-md border border-border shadow-e2',
        maximized ? 'w-48' : 'w-24',
      )}
    >
      <VideoTileView
        tile={presence.value}
        spotlit={false}
        className="aspect-video"
      />
    </div>
  );
}

function VideoError({ message }: { message: string | null }) {
  const presence = useExitPresence(message, PANEL_EXIT_MS);
  if (!presence.value) return null;

  return (
    <p
      role="status"
      data-phase={presence.exiting ? 'closing' : 'open'}
      className="video-panel-error -translate-x-1/2 absolute bottom-2 left-1/2 max-w-[calc(100%-1rem)] rounded-full border border-danger-border bg-surface px-3 py-1 text-danger-fg text-sm"
    >
      {presence.value}
    </p>
  );
}

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
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setReady(false);
    video.srcObject = stream ?? null;
    if (stream && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      setReady(true);
    }
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
        onCanPlay={() => setReady(true)}
        onPlaying={() => setReady(true)}
        className={cn(
          'size-full transition-opacity duration-slow ease-out-quart motion-reduce:transition-none',
          ready ? 'opacity-100' : 'opacity-0',
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
    'video-tile-motion relative min-h-0 overflow-hidden rounded-md bg-black',
    spotlit && 'flex-1',
    className,
  );
  const style = {
    viewTransitionName: `video-tile-${tile.clientId}-${tile.kind}`,
  };

  if (!onSpotlight) {
    return (
      <div className={shell} style={style} data-video-tile-key={tile.key}>
        {body}
      </div>
    );
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
      style={style}
      data-video-tile-key={tile.key}
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
