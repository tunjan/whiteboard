import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireCamera, cameraConstraints } from './camera';

function videoTrack(id = 'camera') {
  return {
    id,
    stop: vi.fn(),
    contentHint: '',
  } as unknown as MediaStreamTrack;
}

function stubGetUserMedia(
  result: Promise<unknown> | (() => Promise<unknown>),
): void {
  vi.stubGlobal('navigator', {
    mediaDevices: {
      getUserMedia: vi.fn(() =>
        typeof result === 'function' ? result() : result,
      ),
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cameraConstraints', () => {
  it('caps capture so a mesh call stays affordable', () => {
    expect(cameraConstraints()).toEqual({
      width: { ideal: 640 },
      height: { ideal: 360 },
      frameRate: { ideal: 24 },
      facingMode: 'user',
    });
  });
});

describe('acquireCamera', () => {
  it('returns the first track, stops extras, and hints motion', async () => {
    const wanted = videoTrack('wanted');
    const extra = videoTrack('extra');
    stubGetUserMedia(
      Promise.resolve({
        getVideoTracks: () => [wanted, extra],
        getTracks: () => [wanted, extra],
      }),
    );

    const track = await acquireCamera();

    expect(track).toBe(wanted);
    expect(track.contentHint).toBe('motion');
    expect(extra.stop).toHaveBeenCalledTimes(1);
    expect(wanted.stop).not.toHaveBeenCalled();
  });

  it.each([
    ['NotAllowedError', 'Camera blocked'],
    ['NotFoundError', 'No camera found'],
    ['NotReadableError', 'Camera unavailable'],
    ['TrackStartError', 'Camera unavailable'],
  ])('maps %s to "%s"', async (name, message) => {
    stubGetUserMedia(() => Promise.reject(new DOMException('', name)));

    await expect(acquireCamera()).rejects.toThrow(message);
  });

  it('reports the insecure-context cause rather than a permission problem', async () => {
    vi.stubGlobal('isSecureContext', false);

    await expect(acquireCamera()).rejects.toThrow('Camera needs HTTPS');
  });

  it('reports no camera when the API is missing', async () => {
    vi.stubGlobal('navigator', { mediaDevices: undefined });

    await expect(acquireCamera()).rejects.toThrow('No camera found');
  });

  it('stops the stream when it yields no video track', async () => {
    const audioOnly = videoTrack('audio');
    stubGetUserMedia(
      Promise.resolve({
        getVideoTracks: () => [],
        getTracks: () => [audioOnly],
      }),
    );

    await expect(acquireCamera()).rejects.toThrow('No camera found');
    expect(audioOnly.stop).toHaveBeenCalledTimes(1);
  });
});
