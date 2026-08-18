import { describe, expect, it, vi } from 'vitest';
import {
  hasEquationFocusRequest,
  requestEquationFocus,
  resolveEquationFocus,
  subscribeEquationFocus,
} from './equation-focus';

describe('equation focus hand-off', () => {
  it('holds the request open until focus actually lands', () => {
    requestEquationFocus('eq-1');

    expect(hasEquationFocusRequest('eq-1')).toBe(true);
    // Reading it must not spend it: the panel that mounts, schedules a focus
    // frame and is then torn down (StrictMode, an input-mode switch) has to
    // find the request still outstanding on its second try.
    expect(hasEquationFocusRequest('eq-1')).toBe(true);

    resolveEquationFocus('eq-1');
    // A re-mount of the same panel must not steal focus a second time.
    expect(hasEquationFocusRequest('eq-1')).toBe(false);
  });

  it('denies focus to an equation that was merely selected', () => {
    requestEquationFocus('eq-1');

    expect(hasEquationFocusRequest('eq-2')).toBe(false);
    // The pending request survives an unrelated selection.
    expect(hasEquationFocusRequest('eq-1')).toBe(true);

    resolveEquationFocus('eq-1');
  });

  it('ignores a resolve for a shape that did not ask', () => {
    requestEquationFocus('eq-1');

    resolveEquationFocus('eq-2');

    expect(hasEquationFocusRequest('eq-1')).toBe(true);
    resolveEquationFocus('eq-1');
  });

  it('denies focus when nothing was placed', () => {
    expect(hasEquationFocusRequest('eq-1')).toBe(false);
  });

  it('notifies an already-mounted equation panel', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeEquationFocus(listener);

    requestEquationFocus('eq-1');

    expect(listener).toHaveBeenCalledWith('eq-1');
    unsubscribe();
    resolveEquationFocus('eq-1');
  });
});
