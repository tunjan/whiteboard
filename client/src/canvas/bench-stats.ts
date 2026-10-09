// TEMPORARY perf harness — delete with ./zoom-bench.ts and ./scale-bench.ts.
//
// Statistics, table formatting and machine gating shared by both harnesses.
// Shared because the two had drifted: the same off-by-one quantile and the
// same hard-coded 60Hz idle gate existed in both, and a column that means one
// thing in the zoom table and another in the scale table is worse than no
// column at all.

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
export const mean = (a: readonly number[]) =>
  a.length ? sum(a) / a.length : 0;

/**
 * Nearest-rank quantile: the smallest sample at or above the p-th percentile.
 *
 * `floor(n * p)` — what both harnesses used — overshoots by one at every p,
 * so the "median" of 120 frames was the 61st smallest and p95 was the 115th.
 * Small on a smooth run and not small at all on a run with a fat tail, which
 * is exactly the run the number exists to describe.
 */
export function quantile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))]!;
}

export const median = (values: readonly number[]) => quantile(values, 0.5);

/**
 * Per-sample `total - part`, clamped at zero.
 *
 * Subtracting one median from another is not this. `median(frame) -
 * median(js)` pairs the middle frame with the middle JS callback, which are
 * generally different frames, and the answer is not a time any frame actually
 * spent anywhere. Differencing first and then taking the median of the
 * differences is a quantity each frame really had.
 */
export function residuals(
  total: readonly number[],
  part: readonly number[],
): number[] {
  const n = Math.min(total.length, part.length);
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.max(0, total[i]! - part[i]!));
  return out;
}

/**
 * Field-wise median across repeats of the same measurement.
 *
 * Statistic-per-repeat, then median across repeats — not one statistic over
 * the pooled samples. Pooling lets a single bad repeat (a background process,
 * a GC pause that only hit one run) smear across the whole cell, which is the
 * thing repeats exist to contain.
 */
export function medianFields<T extends object>(reps: readonly T[]): T {
  const out = {} as Record<keyof T, number>;
  for (const key of Object.keys(reps[0] ?? {}) as (keyof T)[]) {
    out[key] = median(reps.map((r) => Number(r[key] ?? 0)));
  }
  return out as T;
}

/** Relative spread of a set of repeat measurements, as a fraction. */
export function spread(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const mid = median(values);
  if (!mid) return 0;
  return (Math.max(...values) - Math.min(...values)) / mid;
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

export interface Column {
  /** Heading text. Also the minimum width of the column. */
  head: string;
  /** Right-aligned field width. Widened to fit `head` if narrower. */
  width: number;
}

const widthOf = (c: Column) => Math.max(c.width, c.head.length);

export function headerLine(
  label: string,
  labelWidth: number,
  columns: readonly Column[],
): string {
  return [
    label.padEnd(labelWidth),
    ...columns.map((c) => c.head.padStart(widthOf(c))),
  ].join(' ');
}

/**
 * Format one row against the same column list the header came from.
 *
 * The count check is the point of this function. The zoom table's header
 * advertised a `captures` column that the row formatter never emitted, so
 * every column to its right was read under the wrong name — the kind of error
 * that survives indefinitely because the numbers still look plausible.
 */
export function dataLine(
  label: string,
  labelWidth: number,
  columns: readonly Column[],
  cells: readonly (string | number)[],
): string {
  if (cells.length !== columns.length) {
    throw new Error(
      `bench table: ${columns.length} columns but ${cells.length} cells for "${label}"`,
    );
  }
  return [
    label.padEnd(labelWidth),
    ...columns.map((c, i) => String(cells[i]).padStart(widthOf(c))),
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Machine gating
// ---------------------------------------------------------------------------

export const settle = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve once the tab is actually on screen.
 *
 * A background tab gets a throttled `requestAnimationFrame`, so a run started
 * in one never finishes — it sits there spinning the ramp at a frame a second,
 * burning a core and poisoning whatever is being measured in the foreground.
 * Waiting is also the only honest thing to do: frame timings from a tab the
 * compositor isn't presenting are not measurements of anything.
 */
export function whenVisible(): Promise<void> {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve) => {
    const onChange = () => {
      if (document.hidden) return;
      document.removeEventListener('visibilitychange', onChange);
      resolve();
    };
    document.addEventListener('visibilitychange', onChange);
  });
}

/** Fallback frame interval when the display's rate cannot be measured. */
const ASSUMED_REFRESH_MS = 1000 / 60;

/**
 * Measure the display's frame interval on an idle page.
 *
 * Every gate and threshold in both harnesses was written against 60Hz: "idle"
 * meant a frame under 18ms and "slow" meant one over 20ms. On a 120Hz panel
 * every frame is ~8.3ms, so the idle gate passes while the machine is still
 * chewing through seeding work, and a frame that missed its deadline by 100%
 * is not counted as slow. On a 30Hz external display nothing is ever idle and
 * every frame is slow. Measuring once, up front, makes both relative.
 */
export function measureRefreshMs(samples = 40): Promise<number> {
  return new Promise((resolve) => {
    const intervals: number[] = [];
    let last = -1;
    const tick = (now: number) => {
      if (last >= 0) intervals.push(now - last);
      last = now;
      if (intervals.length >= samples) resolve(median(intervals));
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    // A hidden or otherwise unpresented tab never delivers these frames.
    setTimeout(
      () => resolve(intervals.length ? median(intervals) : ASSUMED_REFRESH_MS),
      5000,
    );
  });
}

export interface IdleOptions {
  /** Consecutive cheap frames required. */
  need?: number;
  timeoutMs?: number;
  /** A frame counts as cheap below `refreshMs * tolerance`. */
  tolerance?: number;
}

/**
 * Block until the page has been idle for `need` consecutive cheap frames.
 *
 * Seeding writes thousands of shapes through the document store, and that work
 * carries on well after the shapes are on screen. Without this gate the first
 * configs in a matrix are measured against a busy machine and the last ones
 * against a quiet one, which reads exactly like a config difference and is not
 * one. A fixed sleep cannot do the job — how long the writes take depends on
 * the shape count and on whether the profile is warm.
 */
export function waitForIdle(
  refreshMs: number,
  { need = 45, timeoutMs = 120000, tolerance = 1.5 }: IdleOptions = {},
): Promise<boolean> {
  const budget = refreshMs * tolerance;
  return new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let run = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      run = dt < budget ? run + 1 : 0;
      if (run >= need) resolve(true);
      else if (now > deadline) resolve(false);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ---------------------------------------------------------------------------
// Machine description
// ---------------------------------------------------------------------------

export function engineName(): string {
  const ua = navigator.userAgent;
  if (ua.includes('Firefox')) return 'Firefox';
  if (ua.includes('Chrome')) return 'Chromium';
  return 'WebKit';
}

export function machineLine(refreshMs: number): string {
  const cores = navigator.hardwareConcurrency || 0;
  return (
    `${engineName()}  ${innerWidth}x${innerHeight}  dpr ${devicePixelRatio}  ` +
    `${cores || '?'} cores  display ${(1000 / refreshMs).toFixed(0)}Hz ` +
    `(${refreshMs.toFixed(1)}ms)  ${new Date().toISOString()}`
  );
}

// ---------------------------------------------------------------------------
// Repetition
// ---------------------------------------------------------------------------

/**
 * Run every cell `reps` times, rep-major, and collect the results per cell.
 *
 * Rep-major is the whole point. Running a config's repeats back to back leaves
 * the fixed config order confounded with everything that drifts over the life
 * of the run — thermal throttling, a growing heap, the OS deciding the tab
 * deserves a smaller core. Under that schedule the last config in the list is
 * measured on a different machine than the first, and the table reports the
 * difference as though it were caused by the config. Cycling through all
 * configs once per repeat spreads the drift evenly across them instead, which
 * does not remove it but does stop it from imitating a result.
 */
export async function repeatInterleaved<K, T>(
  cells: readonly K[],
  reps: number,
  runOne: (cell: K, rep: number) => Promise<T>,
): Promise<Map<K, T[]>> {
  const out = new Map<K, T[]>();
  for (const cell of cells) out.set(cell, []);
  for (let rep = 0; rep < reps; rep++) {
    for (const cell of cells) out.get(cell)!.push(await runOne(cell, rep));
  }
  return out;
}

/**
 * Warnings about a set of repeat runs, or an empty list if the table is sound.
 *
 * `driftPairs` are cells expected to be identical — a config and its repeat at
 * the end of the matrix. Both harnesses already ran such a repeat and then
 * printed it for a human to eyeball, which is to say never. A disagreement
 * between them is drift in the machine, and it invalidates every other line
 * in the table, so it is worth saying out loud.
 */
export function auditRun(
  perCell: readonly { label: string; repMedians: readonly number[] }[],
  driftPairs: readonly [string, string][],
  { maxSpread = 0.1, maxDrift = 0.1 } = {},
): string[] {
  const warnings: string[] = [];
  const byLabel = new Map(perCell.map((c) => [c.label, c]));

  for (const cell of perCell) {
    const s = spread(cell.repMedians);
    if (s > maxSpread) {
      warnings.push(
        `[UNSTABLE] ${cell.label}: repeats span ${(100 * s).toFixed(0)}% ` +
          `(${cell.repMedians.map((v) => v.toFixed(1)).join(' / ')}ms) — ` +
          `more than the ${(100 * maxSpread).toFixed(0)}% this table can resolve`,
      );
    }
  }

  for (const [a, b] of driftPairs) {
    const left = byLabel.get(a);
    const right = byLabel.get(b);
    if (!left || !right) continue;
    const base = median(left.repMedians);
    const repeat = median(right.repMedians);
    if (!base) continue;
    const drift = Math.abs(repeat - base) / base;
    if (drift > maxDrift) {
      warnings.push(
        `[DRIFT] ${a} ${base.toFixed(1)}ms vs ${b} ${repeat.toFixed(1)}ms ` +
          `(${(100 * drift).toFixed(0)}%) — the machine changed under the run; ` +
          `treat every comparison above as noise`,
      );
    }
  }

  return warnings;
}
