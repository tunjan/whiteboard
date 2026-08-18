import { describe, expect, it } from 'vitest';
import { consumesWheel, type ScrollMetrics } from './use-pass-through-wheel';

function metrics(over: Partial<ScrollMetrics> = {}): ScrollMetrics {
  return {
    overflowX: 'visible',
    overflowY: 'visible',
    scrollWidth: 200,
    clientWidth: 200,
    scrollHeight: 400,
    clientHeight: 400,
    ...over,
  };
}

describe('wheel ownership inside floating panels', () => {
  it('forwards to the board over ordinary panel chrome', () => {
    expect(consumesWheel(metrics())).toBe(false);
  });

  it('keeps the wheel on a panel whose content actually overflows', () => {
    expect(
      consumesWheel(
        metrics({ overflowY: 'auto', scrollHeight: 900, clientHeight: 400 }),
      ),
    ).toBe(true);
    expect(
      consumesWheel(
        metrics({ overflowX: 'scroll', scrollWidth: 800, clientWidth: 200 }),
      ),
    ).toBe(true);
  });

  // The style panel declares `overflow-y-auto` unconditionally but is usually
  // shorter than its box. Scrolling over it should still pan the board.
  it('forwards when a scroll container has nothing to scroll', () => {
    expect(
      consumesWheel(
        metrics({ overflowY: 'auto', scrollHeight: 400, clientHeight: 400 }),
      ),
    ).toBe(false);
  });

  it('forwards over clipped content, which never scrolls', () => {
    expect(
      consumesWheel(
        metrics({ overflowY: 'hidden', scrollHeight: 900, clientHeight: 400 }),
      ),
    ).toBe(false);
  });
});
