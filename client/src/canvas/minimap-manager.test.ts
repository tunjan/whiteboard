// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MinimapManager } from './minimap-manager';
import { useCameraStore } from './use-camera-store';
import { spatialIndex } from './use-document-store';

// Every context method is a no-op; the test counts index scans, not pixels.
const ctx = new Proxy({}, { get: () => () => {} });

let manager: MinimapManager | null = null;
afterEach(() => {
  manager?.close();
  manager = null;
  vi.restoreAllMocks();
});

describe('minimap perf', () => {
  it('pans without re-scanning the page', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    const elem = document.createElement('canvas');
    elem.getContext = (() => ctx) as unknown as typeof elem.getContext;
    const scans = vi.spyOn(spatialIndex, 'totalBounds');

    manager = new MinimapManager(elem);
    const afterMount = scans.mock.calls.length;
    for (let i = 1; i <= 10; i++) {
      const { camera } = useCameraStore.getState();
      useCameraStore.getState().setCamera({ ...camera, x: camera.x + i });
    }

    expect(scans.mock.calls.length).toBe(afterMount);
  });
});
