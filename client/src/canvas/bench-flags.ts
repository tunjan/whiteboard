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
