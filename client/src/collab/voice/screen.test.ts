import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireScreen, screenConstraints } from './screen';

function mediaTrack(id: string) {
  return {
    id,
    stop: vi.fn(),
    contentHint: '',
  } as unknown as MediaStreamTrack;
}

function stubGetDisplayMedia(
  result: Promise<unknown> | (() => Promise<unknown>),
): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getDisplayMedia: vi.fn(() =>
        typeof result === 'function' ? result() : result,
      ),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('screenConstraints', () => {
  it('trades frame rate for legible resolution', () => {
    expect(screenConstraints()).toEqual({ frameRate: { ideal: 8 } });
  });
});

describe('acquireScreen', () => {
  it('returns the video track, drops forced tab audio, and hints detail', async () => {
    const video = mediaTrack('screen');
    const audio = mediaTrack('tab-audio');
    stubGetDisplayMedia(
      Promise.resolve({
        getVideoTracks: () => [video],
        getAudioTracks: () => [audio],
        getTracks: () => [video, audio],
      }),
    );

    const track = await acquireScreen();

    expect(track).toBe(video);
    expect(track?.contentHint).toBe('detail');
    // There is no transceiver for screen audio, so it must not stay live.
    expect(audio.stop).toHaveBeenCalledTimes(1);
  });

  it.each(['NotAllowedError', 'AbortError'])(
    'treats %s as a dismissed picker, not an error',
    async (name) => {
      stubGetDisplayMedia(() => Promise.reject(new DOMException('', name)));

      await expect(acquireScreen()).resolves.toBeNull();
    },
  );

  it('surfaces an unsupported browser', async () => {
    stubGetDisplayMedia(() =>
      Promise.reject(new DOMException('', 'NotSupportedError')),
    );

    await expect(acquireScreen()).rejects.toThrow(
      'Screen sharing unavailable',
    );
  });

  it('reports the insecure-context cause', async () => {
    vi.stubGlobal('isSecureContext', false);

    await expect(acquireScreen()).rejects.toThrow(
      'Screen sharing needs HTTPS',
    );
  });

  it('reports unavailable when the API is missing', async () => {
    vi.stubGlobal('navigator', { mediaDevices: {} });

    await expect(acquireScreen()).rejects.toThrow(
      'Screen sharing unavailable',
    );
  });
});
