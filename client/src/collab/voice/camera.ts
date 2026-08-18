export type CameraErrorMessage =
  | 'Camera blocked'
  | 'No camera found'
  | 'Camera unavailable'
  | 'Camera needs HTTPS';

/**
 * Capped on purpose. Every participant encodes one copy per peer in a full
 * mesh, so capture resolution is the cheapest lever on the whole call.
 */
export function cameraConstraints(): MediaTrackConstraints {
  return {
    width: { ideal: 640 },
    height: { ideal: 360 },
    frameRate: { ideal: 24 },
    facingMode: 'user',
  };
}

/** Ask for one camera track. */
export async function acquireCamera(): Promise<MediaStreamTrack> {
  if (globalThis.isSecureContext === false) {
    throw new Error('Camera needs HTTPS' satisfies CameraErrorMessage);
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error('No camera found' satisfies CameraErrorMessage);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: cameraConstraints(),
    });
  } catch (error) {
    throw new Error(cameraErrorMessage(error));
  }

  const [track, ...extraTracks] = stream.getVideoTracks();
  extraTracks.forEach((extraTrack) => extraTrack.stop());
  if (!track) {
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    throw new Error('No camera found' satisfies CameraErrorMessage);
  }
  track.contentHint = 'motion';
  return track;
}

function cameraErrorMessage(error: unknown): CameraErrorMessage {
  if (error instanceof DOMException) {
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      return 'Camera blocked';
    }
    if (
      error.name === 'NotFoundError' ||
      error.name === 'DevicesNotFoundError'
    ) {
      return 'No camera found';
    }
    // A camera held by another app is far more common than a busy microphone.
    if (
      error.name === 'NotReadableError' ||
      error.name === 'TrackStartError'
    ) {
      return 'Camera unavailable';
    }
  }
  return globalThis.isSecureContext === false
    ? 'Camera needs HTTPS'
    : 'Camera blocked';
}
