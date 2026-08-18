export type ScreenErrorMessage =
  | 'Screen sharing unavailable'
  | 'Screen sharing needs HTTPS';

/**
 * Shared screens are mostly still text, so full resolution at a low frame rate
 * reads far better than a downscaled 30 fps stream on the same bandwidth.
 */
export function screenConstraints(): MediaTrackConstraints {
  return { frameRate: { ideal: 8 } };
}

/**
 * Ask for one screen-share track.
 *
 * Resolves `null` when the picker is dismissed — cancelling is the normal way
 * out of the dialog, not a failure worth showing.
 */
export async function acquireScreen(): Promise<MediaStreamTrack | null> {
  if (globalThis.isSecureContext === false) {
    throw new Error(
      'Screen sharing needs HTTPS' satisfies ScreenErrorMessage,
    );
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getDisplayMedia
  ) {
    throw new Error(
      'Screen sharing unavailable' satisfies ScreenErrorMessage,
    );
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: screenConstraints(),
    });
  } catch (error) {
    if (isPickerDismissed(error)) return null;
    throw new Error(
      'Screen sharing unavailable' satisfies ScreenErrorMessage,
    );
  }

  // Sharing a tab can attach its audio regardless of the constraint, and there
  // is no transceiver for it.
  stream.getAudioTracks().forEach((audioTrack) => audioTrack.stop());

  const [track, ...extraTracks] = stream.getVideoTracks();
  extraTracks.forEach((extraTrack) => extraTrack.stop());
  if (!track) {
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    return null;
  }
  track.contentHint = 'detail';
  return track;
}

function isPickerDismissed(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError' ||
      error.name === 'AbortError')
  );
}
