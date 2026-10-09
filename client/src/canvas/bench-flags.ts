// TEMPORARY perf harness — delete together with ./zoom-bench.ts.
//
// Runtime A/B switches, so one page load can run the whole config matrix
// instead of one reload per variant (reloads add JIT-warmup and GC noise that
// swamps the differences being measured). Kept in its own module because
// `zoom-bench.ts` is dynamically imported and must stay out of the bundle,
// while these switches have to be readable from the render path.
import { create } from 'zustand';

export interface BenchFlags {
  /** Skip the dot/line grid background. */
  noBg: boolean;
  /** Mount no shapes at all (leaves background + chrome). */
  noShapes: boolean;
}

export const useBenchFlags = create<BenchFlags>(() => ({
  noBg: false,
  noShapes: false,
}));

/** Per-subsystem timings, collected by the render path, drained per run. */
export const benchCounters = {
  /** One entry per spatial-index search. */
  cull: [] as number[],
  /** One entry per rebuild of the mounted shape tree. */
  tree: [] as number[],
};

export function resetBenchCounters(): void {
  benchCounters.cull.length = 0;
  benchCounters.tree.length = 0;
}

/**
 * The Canvas2D paint split, accumulated by `canvas-2d-renderer` and zeroed by
 * the driver at the top of each frame.
 *
 * It answers one question: of the JS a zoom frame spends, how much is the
 * per-shape paint loop — the part a batched, chunk-keyed path would remove —
 * and how much is work that survives batching?
 *
 *  - `collectMs`   gathering the drawable set: three signal reads per id.
 *  - `sortMs`      ordering that set by z. Separate because it is re-done from
 *                  scratch every frame over the whole visible set, and a batch
 *                  keyed to spatial chunks removes it outright.
 *  - `conditionMs` building stroke geometry, accumulated ONLY on the branch
 *                  that misses the cache. Timing the hit path too would mean
 *                  two `performance.now()` calls per shape per frame, which at
 *                  5k shapes is a cost large enough to distort what it reports.
 *  - `drawMs`      the whole paint loop, conditioning included.
 *
 * `drawMs - conditionMs` is therefore the per-shape cost of placing and filling
 * already-built paths: one `setTransform` and one `fill` each, plus the cache
 * lookup. That residual is the batchable budget, and it is the number the
 * decision turns on. Differenced per frame by the reporter, never median from
 * median.
 *
 * Always on, like `data-canvas-2d-built` beside it: six `performance.now()`
 * calls per frame is not a cost worth a flag, and a counter that only exists
 * under the harness cannot be read while poking at a real board.
 */
export const paintCounters = {
  collectMs: 0,
  sortMs: 0,
  conditionMs: 0,
  drawMs: 0,
};

export function resetPaintCounters(): void {
  paintCounters.collectMs = 0;
  paintCounters.sortMs = 0;
  paintCounters.conditionMs = 0;
  paintCounters.drawMs = 0;
}
