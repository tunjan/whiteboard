// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  RIGHT_DRAG_THRESHOLD,
  exceedsRightDragThreshold,
  useSpacePan,
} from './use-space-pan';

describe('exceedsRightDragThreshold', () => {
  it('holds a right press inside the click slop', () => {
    expect(exceedsRightDragThreshold(0, 0)).toBe(false);
    expect(exceedsRightDragThreshold(RIGHT_DRAG_THRESHOLD, 0)).toBe(false);
    expect(exceedsRightDragThreshold(-3, 2)).toBe(false);
  });

  it('reads travel past the slop as a drag, in any direction', () => {
    expect(exceedsRightDragThreshold(RIGHT_DRAG_THRESHOLD + 1, 0)).toBe(true);
    expect(exceedsRightDragThreshold(0, -(RIGHT_DRAG_THRESHOLD + 1))).toBe(true);
    expect(exceedsRightDragThreshold(3, 3)).toBe(true);
  });
});

describe('useSpacePan', () => {
  it('lets go of Space when the window loses focus with it held', () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    let spaceDown: boolean | undefined;
    function Probe() {
      spaceDown = useSpacePan().isSpaceDown;
      return null;
    }
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' }));
    });
    expect(spaceDown).toBe(true);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(spaceDown).toBe(false);
    act(() => root.unmount());
  });
});
