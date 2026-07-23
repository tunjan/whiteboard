export type MicErrorMessage =
  | 'Microphone blocked'
  | 'No microphone found'
  | 'Voice needs HTTPS';

export function micConstraints(
  noiseCancellation: boolean,
): MediaTrackConstraints {
  return {
    echoCancellation: true,
    autoGainControl: true,
    noiseSuppression: noiseCancellation,
  };
}

/** Ask for one microphone track. The returned track is always muted. */
export async function acquireMic(
  noiseCancellation: boolean,
): Promise<MediaStreamTrack> {
  if (globalThis.isSecureContext === false) {
    throw new Error('Voice needs HTTPS' satisfies MicErrorMessage);
  }
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.getUserMedia
  ) {
    throw new Error('No microphone found' satisfies MicErrorMessage);
  }

  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraints(noiseCancellation),
      video: false,
    });
  } catch (error) {
    throw new Error(micErrorMessage(error));
  }

  const [track, ...extraTracks] = stream.getAudioTracks();
  extraTracks.forEach((extraTrack) => extraTrack.stop());
  if (!track) {
    stream.getTracks().forEach((streamTrack) => streamTrack.stop());
    throw new Error('No microphone found' satisfies MicErrorMessage);
  }
  track.enabled = false;
  return track;
}

/**
 * Update noise suppression in place when the browser honors the constraint,
 * otherwise return a replacement track for each RTCRtpSender.
 */
export async function applyNoiseCancellation(
  track: MediaStreamTrack,
  enabled: boolean,
): Promise<{ track: MediaStreamTrack; replaced: boolean }> {
  try {
    await track.applyConstraints(micConstraints(enabled));
    if (track.getSettings().noiseSuppression === enabled) {
      return { track, replaced: false };
    }
  } catch {
    // Some browsers reject or silently ignore a live constraint change. The
    // static connection can keep its sender while the capture track is swapped.
  }

  const replacement = await acquireMic(enabled);
  replacement.enabled = track.enabled;
  return { track: replacement, replaced: true };
}

function micErrorMessage(error: unknown): MicErrorMessage {
  if (error instanceof DOMException) {
    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      return 'Microphone blocked';
    }
    if (
      error.name === 'NotFoundError' ||
      error.name === 'DevicesNotFoundError'
    ) {
      return 'No microphone found';
    }
  }
  return globalThis.isSecureContext === false
    ? 'Voice needs HTTPS'
    : 'Microphone blocked';
}
