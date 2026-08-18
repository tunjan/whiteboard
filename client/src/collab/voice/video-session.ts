import type { VideoKind } from '@whiteboard/shared';
import { acquireCamera } from './camera';
import { acquireScreen } from './screen';
import { useVideoStore } from './use-video-store';
import { useVoiceStore } from './use-voice-store';
import { setLocalVideoTrack } from './voice-session';

/**
 * Camera and screen capture for the call. The mesh itself lives in
 * `voice-session`, which owns the peer connections and the fan-out; this module
 * only acquires tracks, tracks their lifetime, and hands them over.
 *
 * Acquisition is async and the call can end while a permission prompt is open,
 * so every await is followed by a generation check — the same guard `joinVoice`
 * uses for the microphone.
 */
let enableGeneration = 0;

export async function enableCamera(): Promise<void> {
  await enableVideo('camera', acquireCamera);
}

export function disableCamera(): void {
  disableVideo('camera');
}

export async function enableScreen(): Promise<void> {
  await enableVideo('screen', acquireScreen);
}

export function disableScreen(): void {
  disableVideo('screen');
}

async function enableVideo(
  kind: VideoKind,
  acquire: () => Promise<MediaStreamTrack | null>,
): Promise<void> {
  const store = useVideoStore.getState();
  if (useVoiceStore.getState().status !== 'joined') return;
  if (kind === 'camera' ? store.cameraEnabled : store.screenEnabled) return;

  const generation = enableGeneration;
  let track: MediaStreamTrack | null;
  try {
    track = await acquire();
  } catch (error) {
    if (generation !== enableGeneration) return;
    useVideoStore
      .getState()
      .setError(error instanceof Error ? error.message : 'Video unavailable');
    return;
  }

  // The picker was dismissed, or the call ended while it was open.
  if (!track) return;
  if (
    generation !== enableGeneration ||
    useVoiceStore.getState().status !== 'joined'
  ) {
    track.stop();
    return;
  }

  // The browser's own "Stop sharing" control, and unplugged cameras, end the
  // track behind our back.
  track.addEventListener('ended', () => {
    if (localTrackFor(kind) === track) disableVideo(kind);
  });

  setLocalVideoTrack(kind, track);
  const next = useVideoStore.getState();
  next.setLocalVideo(kind, new MediaStream([track]));
  next.setError(null);
  if (kind === 'camera') next.setCameraEnabled(true);
  else next.setScreenEnabled(true);
}

function disableVideo(kind: VideoKind): void {
  enableGeneration += 1;
  const track = localTrackFor(kind);
  setLocalVideoTrack(kind, null);
  track?.stop();

  const store = useVideoStore.getState();
  store.setLocalVideo(kind, null);
  if (kind === 'camera') store.setCameraEnabled(false);
  else store.setScreenEnabled(false);
}

function localTrackFor(kind: VideoKind): MediaStreamTrack | null {
  const store = useVideoStore.getState();
  const stream = kind === 'camera' ? store.localCamera : store.localScreen;
  return stream?.getVideoTracks()[0] ?? null;
}
