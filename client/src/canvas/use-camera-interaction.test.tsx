// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Camera } from './camera';
import {
  useCameraFollow,
  useCameraInteraction,
  useCameraPlacement,
} from './use-camera-interaction';
import { useCameraStore } from './use-camera-store';

let host: HTMLDivElement, root: Root;
let renders = 0;
let rendered: Camera | null = null;

function SvgProbe() {
  const [camera, follow] = useCameraFollow<SVGGElement>();
  renders++;
  rendered = camera;
  return (
    <svg>
      <g ref={follow} />
    </svg>
  );
}

function HtmlProbe() {
  const [, follow] = useCameraFollow<HTMLDivElement>();
  return <div ref={follow} />;
}

const setCamera = (camera: Camera) => useCameraStore.setState({ camera });
const follower = () => host.querySelector('g')!.getAttribute('transform');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setCamera({ x: 0, y: 0, z: 1 });
  useCameraInteraction.setState({ isMoving: false });
  renders = 0;
  rendered = null;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('useCameraFollow', () => {
  it('moves the follower on a pan without re-rendering', async () => {
    await act(() => root.render(<SvgProbe />));
    const before = renders;

    await act(() => setCamera({ x: 10, y: 5, z: 1 }));

    expect(follower()).toBe('translate(-10 -5)');
    expect(renders).toBe(before);
    // The overlay's own math stays anchored at the world origin.
    expect(rendered).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('bridges a zoom React has not rendered yet with a scale', async () => {
    await act(() => root.render(<SvgProbe />));

    let interim: string | null = null;
    await act(() => {
      setCamera({ x: 10, y: 0, z: 2 });
      // The listener has run; React has not committed the new zoom.
      interim = follower();
    });

    // Content drawn at zoom 1 is stretched to zoom 2 until the commit lands...
    expect(interim).toBe('translate(-20 0) scale(2)');
    // ...and the commit redraws it at zoom 2 and drops the stretch.
    expect(rendered).toEqual({ x: 0, y: 0, z: 2 });
    expect(follower()).toBe('translate(-20 0)');
  });

  it('snaps to the device pixel grid only once the camera settles', async () => {
    await act(() => root.render(<SvgProbe />));

    await act(() => setCamera({ x: 10.3, y: 0, z: 1 }));
    expect(useCameraInteraction.getState().isMoving).toBe(true);
    expect(follower()).toBe('translate(-10.3 0)');

    await act(() => useCameraInteraction.setState({ isMoving: false }));
    expect(follower()).toBe(`translate(${Math.round(-10.3 * devicePixelRatio) / devicePixelRatio} 0)`);
  });

  it('positions an HTML follower with a CSS transform from its top-left', async () => {
    await act(() => root.render(<HtmlProbe />));
    await act(() => setCamera({ x: 3, y: 4, z: 1 }));

    const div = host.querySelector('div')!;
    expect(div.style.transform).toBe('translate(-3px, -4px)');
    expect(div.style.transformOrigin).toBe('0 0');
  });
});

describe('useCameraPlacement', () => {
  function Placed({ offset }: { offset: number }) {
    renders++;
    const place = useCameraPlacement<HTMLDivElement>((element, camera) => {
      element.style.left = `${offset - camera.x}px`;
    });
    return <div ref={place} />;
  }

  it('places on mount and on every camera change, without re-rendering', async () => {
    await act(() => root.render(<Placed offset={100} />));
    const div = host.querySelector('div')!;
    expect(div.style.left).toBe('100px');
    const before = renders;

    await act(() => setCamera({ x: 30, y: 0, z: 1 }));
    await act(() => setCamera({ x: 45, y: 0, z: 1 }));

    expect(div.style.left).toBe('55px');
    expect(renders).toBe(before);
  });

  it('places with the latest render\'s closure', async () => {
    await act(() => root.render(<Placed offset={100} />));
    await act(() => root.render(<Placed offset={200} />));
    expect(host.querySelector('div')!.style.left).toBe('200px');

    await act(() => setCamera({ x: 10, y: 0, z: 1 }));
    expect(host.querySelector('div')!.style.left).toBe('190px');
  });
});
