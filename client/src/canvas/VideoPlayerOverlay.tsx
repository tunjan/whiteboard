import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { VideoShape } from '@whiteboard/shared';
import { worldToScreen } from './camera';
import { useCameraFollow } from './use-camera-interaction';
import { useVideoPlayingStore } from './use-video-playing-store';

/**
 * Interactive YouTube player shown in place of a video shape's static thumbnail
 * while it's playing. Mirrors `TextEditorOverlay`: an HTML layer positioned over
 * the shape via the camera. Playback state is local (not synced), so playing
 * here doesn't force peers to play.
 */
export function VideoPlayerOverlay({
  shape,
}: {
  shape: VideoShape;
}) {
  const [camera, follow] = useCameraFollow<HTMLDivElement>();
  const stop = useVideoPlayingStore((s) => s.stop);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stop();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stop]);

  const screen = worldToScreen({ x: shape.x, y: shape.y }, camera);
  const w = shape.props.w * camera.z;
  const h = shape.props.h * camera.z;
  const src =
    `https://www.youtube.com/embed/${shape.props.videoId}` +
    `?autoplay=1&rel=0&modestbranding=1`;

  return (
    // The follower is a stacking context, so it carries the z-index.
    <div ref={follow} className="absolute top-0 left-0 z-[var(--z-canvas-front)]">
      <div
        className="absolute overflow-hidden rounded-md bg-black shadow-floating"
        style={{
          left: screen.x,
          top: screen.y,
          width: w,
          height: h,
          transformOrigin: 'center',
          transform: shape.rotation ? `rotate(${shape.rotation}rad)` : undefined,
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <iframe
          title="YouTube video player"
          src={src}
          className="h-full w-full border-0"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
        />
        <button
          type="button"
          aria-label="Stop video"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={stop}
          className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
