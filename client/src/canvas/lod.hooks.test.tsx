// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DrawShape } from '@whiteboard/shared';
import { drawUtil } from './shapes/draw';
import { useCameraStore } from './use-camera-store';
import { useLodStore } from './use-lod-store';

const stroke = (dash: 'solid' | 'dotted', size: number): DrawShape => ({
  id: 'ink',
  type: 'draw',
  x: 0,
  y: 0,
  rotation: 0,
  index: 'a1',
  props: {
    ...drawUtil.getDefaultProps(),
    dash,
    size,
    points: [
      { x: 0, y: 0, pressure: 0.5 },
      { x: 40, y: 10, pressure: 0.5 },
      { x: 80, y: 0, pressure: 0.5 },
    ],
  },
});

// Zustand subscribes each hook through `useSyncExternalStore`, handing it the
// store's own `subscribe` — so counting those calls per render counts hooks.
let lodHooks = 0;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
  const real = React.useSyncExternalStore;
  lodHooks = 0;
  vi.spyOn(React, 'useSyncExternalStore').mockImplementation(
    (subscribe, ...rest) => {
      if (subscribe === useLodStore.subscribe) lodHooks++;
      return real(subscribe, ...rest);
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
});

function mount(shape: DrawShape) {
  const host = document.createElement('div');
  const root = createRoot(host);
  const Ink = drawUtil.Component;
  const render = (s: DrawShape) =>
    act(() =>
      root.render(
        <svg>
          <Ink shape={s} />
        </svg>,
      ),
    );
  render(shape);
  return { host, render, unmount: () => act(() => root.unmount()) };
}

describe('draw shape LOD', () => {
  it('holds a single LOD subscription per stroke', () => {
    const view = mount(stroke('dotted', 2));
    // One render, one hook.
    expect(lodHooks).toBe(1);
    view.unmount();
  });

  it('still flips to solid ink once the stroke is sub-pixel far out', () => {
    const view = mount(stroke('dotted', 2));
    // Dotted ink is a stroked centerline carrying a dash array.
    expect(view.host.querySelector('path')?.getAttribute('stroke-dasharray')).toBeTruthy();
    act(() => useCameraStore.setState({ camera: { x: 0, y: 0, z: 0.25 } }));
    expect(view.host.querySelector('path')?.getAttribute('stroke-dasharray')).toBeNull();
    view.unmount();
  });
});
