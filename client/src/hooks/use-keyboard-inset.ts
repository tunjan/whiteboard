import { useEffect } from 'react';
import { keyboardInset } from './keyboard-inset';

/**
 * Publish the on-screen keyboard's height as `--wb-keyboard-inset` on the
 * document root, for `--wb-inset-bottom` to fold into every bottom-anchored
 * piece of chrome (see section 3 of `index.css`).
 *
 * A CSS variable rather than React state for the same reason the theme is a
 * class on `<html>`: the consumers are a toolbar, two corner HUDs and a call
 * panel that share no component, and threading a number to all of them would
 * re-render the board on every keyboard animation frame.
 */
export function useKeyboardInset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let published = -1;
    const apply = () => {
      const inset = keyboardInset({
        layoutHeight: window.innerHeight,
        visualHeight: vv.height,
        offsetTop: vv.offsetTop,
      });
      if (inset === published) return;
      published = inset;
      document.documentElement.style.setProperty(
        '--wb-keyboard-inset',
        `${inset}px`,
      );
    };

    apply();
    vv.addEventListener('resize', apply);
    vv.addEventListener('scroll', apply);
    return () => {
      vv.removeEventListener('resize', apply);
      vv.removeEventListener('scroll', apply);
      document.documentElement.style.removeProperty('--wb-keyboard-inset');
    };
  }, []);
}
