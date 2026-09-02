import { beforeEach, describe, expect, it } from 'vitest';
import { useVideoStore } from './use-video-store';

const stream = () => ({}) as MediaStream;

beforeEach(() => {
  useVideoStore.getState().resetSession();
});

describe('useVideoStore', () => {
  it('keeps state identity on a no-op remote write', () => {
    const camera = stream();
    useVideoStore.getState().setRemoteVideo(9, 'camera', camera);
    const after = useVideoStore.getState();

    // Remote video arrives once per connection and is re-announced on every
    // reconcile; a fresh Map here would rebind every <video> element.
    useVideoStore.getState().setRemoteVideo(9, 'camera', camera);
    expect(useVideoStore.getState().remoteCameras).toBe(after.remoteCameras);

    useVideoStore.getState().setRemoteVideo(9, 'screen', null);
    expect(useVideoStore.getState().remoteScreens).toBe(after.remoteScreens);
  });

  it('keeps the camera and screen maps independent', () => {
    const camera = stream();
    const screen = stream();
    useVideoStore.getState().setRemoteVideo(9, 'camera', camera);
    useVideoStore.getState().setRemoteVideo(9, 'screen', screen);

    expect(useVideoStore.getState().remoteCameras.get(9)).toBe(camera);
    expect(useVideoStore.getState().remoteScreens.get(9)).toBe(screen);

    useVideoStore.getState().setRemoteVideo(9, 'camera', null);
    expect(useVideoStore.getState().remoteCameras.has(9)).toBe(false);
    expect(useVideoStore.getState().remoteScreens.get(9)).toBe(screen);
  });

  it('keeps the picked view across a mode change', () => {
    useVideoStore.getState().setMode('maximized');
    useVideoStore.getState().setSpotlightKey('9:camera');
    expect(useVideoStore.getState().spotlightKey).toBe('9:camera');

    // The minimised panel spends its one tile on the same pick.
    useVideoStore.getState().setMode('floating');
    expect(useVideoStore.getState().spotlightKey).toBe('9:camera');
  });

  it('drops every trace of the call on reset', () => {
    useVideoStore.getState().setRemoteVideo(9, 'camera', stream());
    useVideoStore.getState().setLocalVideo('screen', stream());
    useVideoStore.getState().setScreenEnabled(true);
    useVideoStore.getState().setPosition({ x: 10, y: 10 });
    useVideoStore.getState().setError('Camera blocked');

    useVideoStore.getState().resetSession();
    const state = useVideoStore.getState();

    expect(state.remoteCameras.size).toBe(0);
    expect(state.localScreen).toBeNull();
    expect(state.screenEnabled).toBe(false);
    expect(state.position).toBeNull();
    expect(state.error).toBeNull();
  });
});
