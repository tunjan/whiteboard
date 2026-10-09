// TEMPORARY — delete with ./bench-stats.ts.
//
// The harnesses that use these are driven by hand and read by eye, so a wrong
// statistic here does not fail anything; it just produces a plausible number
// that gets believed. That is the case for testing them.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  auditRun,
  dataLine,
  headerLine,
  measureRefreshMs,
  medianFields,
  quantile,
  residuals,
  spread,
  waitForIdle,
} from './bench-stats';

describe('quantile', () => {
  it('returns the nearest rank, not one past it', () => {
    const values = Array.from({ length: 120 }, (_, i) => i + 1);
    // The 60th smallest of 120, which is 60 — `floor(n * p)` returned 61.
    expect(quantile(values, 0.5)).toBe(60);
    expect(quantile(values, 0.95)).toBe(114);
    expect(quantile(values, 1)).toBe(120);
  });

  it('is order-independent and safe on empty input', () => {
    expect(quantile([9, 1, 5, 3], 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBe(0);
  });

  it('never runs off the end of the sample', () => {
    expect(quantile([7], 0.95)).toBe(7);
    expect(quantile([1, 2], 0.99)).toBe(2);
  });
});

describe('residuals', () => {
  it('differences per sample rather than subtracting two medians', () => {
    // Frames and JS costs anti-correlated: every frame's browser share is 5,
    // but median(frames) - median(js) reads 10 - 5 = 5 only by coincidence
    // here — the point is the per-frame answer is defined at all.
    const frames = [10, 20, 30];
    const js = [5, 15, 25];
    expect(residuals(frames, js)).toEqual([5, 5, 5]);
  });

  it('clamps a negative residual instead of reporting negative browser time', () => {
    expect(residuals([4], [6])).toEqual([0]);
  });

  it('stops at the shorter array', () => {
    expect(residuals([10, 20], [1])).toEqual([9]);
  });
});

describe('spread', () => {
  it('reports the repeat range as a fraction of the median', () => {
    expect(spread([10, 11, 12])).toBeCloseTo(2 / 11);
    expect(spread([10])).toBe(0);
  });
});

describe('medianFields', () => {
  it('takes the median of each field independently', () => {
    const reps = [
      { fps: 60, frameMed: 16 },
      { fps: 30, frameMed: 33 },
      { fps: 45, frameMed: 22 },
    ];
    expect(medianFields(reps)).toEqual({ fps: 45, frameMed: 22 });
  });
});

describe('tables', () => {
  const columns = [
    { head: 'fps', width: 4 },
    { head: 'frame', width: 6 },
  ];

  it('aligns a row under the header it was built from', () => {
    const head = headerLine('run', 8, columns);
    const line = dataLine('baseline', 8, columns, ['60', '16.7']);
    expect(head).toBe('run       fps  frame');
    expect(line).toBe('baseline   60   16.7');
    expect(line.length).toBe(head.length);
  });

  it('refuses a row that disagrees with the column list', () => {
    // The zoom table's header advertised a `captures` column no row emitted,
    // so every column right of it was read under the wrong name.
    expect(() => dataLine('baseline', 8, columns, ['60'])).toThrow(
      /2 columns but 1 cells/,
    );
  });

  it('widens a column to fit its own heading', () => {
    const wide = [{ head: 'browser', width: 2 }];
    expect(dataLine('x', 1, wide, ['1']).endsWith('      1')).toBe(true);
  });
});

describe('auditRun', () => {
  const stable = [
    { label: 'baseline', repMedians: [10, 10.2, 10.1] },
    { label: 'baseline#2', repMedians: [10.1, 10, 10.3] },
  ];

  it('says nothing about a table whose repeats agree', () => {
    expect(auditRun(stable, [['baseline', 'baseline#2']])).toEqual([]);
  });

  it('flags a cell whose repeats spread wider than the table can resolve', () => {
    const warnings = auditRun(
      [{ label: '-shapes', repMedians: [10, 14, 12] }],
      [],
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[UNSTABLE] -shapes');
  });

  it('flags a baseline that moved while the matrix ran', () => {
    const warnings = auditRun(
      [
        { label: 'baseline', repMedians: [10, 10, 10] },
        { label: 'baseline#2', repMedians: [13, 13, 13] },
      ],
      [['baseline', 'baseline#2']],
    );
    expect(warnings.some((w) => w.startsWith('[DRIFT]'))).toBe(true);
  });

  it('ignores a drift pair whose cells are not in the table', () => {
    expect(auditRun(stable, [['baseline', 'missing']])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Frame gating
// ---------------------------------------------------------------------------

const realRaf = globalThis.requestAnimationFrame;

/**
 * Replace `requestAnimationFrame` with a scripted stream of frame intervals.
 *
 * Timestamps start from `performance.now()` because both gates compare the
 * rAF timestamp against a `performance.now()` deadline — a fake clock starting
 * at zero would never reach one.
 */
function scriptFrames(intervals: number[]) {
  let now = performance.now();
  let i = 0;
  let queue: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  }) as typeof requestAnimationFrame;
  return async function flush(maxFrames = 5000) {
    for (let n = 0; n < maxFrames && queue.length; n++) {
      const [cb] = queue;
      queue = queue.slice(1);
      now += intervals[Math.min(i++, intervals.length - 1)]!;
      cb!(now);
      await Promise.resolve();
    }
  };
}

afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  vi.useRealTimers();
});

describe('measureRefreshMs', () => {
  it('reports the median frame interval of the display', async () => {
    // 120Hz with one hitch, which the median has to ignore.
    const flush = scriptFrames([8.3, 8.3, 40, 8.3]);
    const measured = measureRefreshMs(8);
    await flush();
    await expect(measured).resolves.toBeCloseTo(8.3, 1);
  });

  it('falls back to 60Hz when no frame is ever delivered', async () => {
    vi.useFakeTimers();
    globalThis.requestAnimationFrame = (() =>
      1) as typeof requestAnimationFrame;
    const measured = measureRefreshMs();
    await vi.advanceTimersByTimeAsync(5000);
    await expect(measured).resolves.toBeCloseTo(1000 / 60, 5);
  });
});

describe('waitForIdle', () => {
  it('waits for the frames to go cheap relative to the display', async () => {
    const flush = scriptFrames([50, 50, 50, 8.3]);
    const idle = waitForIdle(8.3, { need: 3 });
    await flush();
    await expect(idle).resolves.toBe(true);
  });

  it('does not call a 120Hz machine idle at 60Hz frame times', async () => {
    // 16.6ms is a comfortable frame on a 60Hz panel and a doubled one on a
    // 120Hz panel. The old gate hard-coded `dt < 18` and passed either way,
    // so on a fast display the harness started measuring while the machine
    // was still busy.
    const flush = scriptFrames([16.6]);
    const idle = waitForIdle(8.3, { need: 3, timeoutMs: 200 });
    await flush();
    await expect(idle).resolves.toBe(false);
  });

  it('restarts the run when a frame goes long', async () => {
    const flush = scriptFrames([8, 8, 40, 8, 8, 8]);
    const idle = waitForIdle(8.3, { need: 3, timeoutMs: 10000 });
    await flush();
    await expect(idle).resolves.toBe(true);
  });
});
