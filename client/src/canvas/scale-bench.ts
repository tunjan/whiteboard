// TEMPORARY perf harness — not part of the app. Delete with
// client/scale-bench.html, client/src/scale-bench.tsx and ./bench-stats.ts.
//
// Answers one question: at 50k shapes, is the frame budget spent in OUR
// JavaScript (spatial index, geometry, presentation) or in the BROWSER
// (style, layout, paint, composite)? That fork decides whether a faster
// language could help at all, or whether the renderer is the thing to change.
//
// Method. Two clocks per frame, the same split `zoom-bench.ts` uses:
//   js    — wall time inside the driver's rAF callback. Setting the camera
//           store runs the scene's signal effects synchronously (cull search,
//           presentation recompute, transform writes), so this is our JS.
//   frame — rAF-to-rAF. Everything the browser does after our JS returns is
//           `frame - js`, differenced per frame and then summarised — not
//           median minus median, which pairs two different frames and names
//           the result a time neither of them spent.
// A sweep where `js` stays flat while `frame` climbs with shape count is a
// rendering cost, and no amount of Rust touches it.
//
// Every table is run `REPS` times, rep-major: a repeat walks the whole table
// before the next one starts. Cell-major ordering leaves the fixed order of
// the rows confounded with everything that drifts over a long run — thermal
// throttling, a heap that keeps growing, the OS moving the tab to a smaller
// core — and then the last row differs from the first for reasons that have
// nothing to do with what the row is testing. The `rep±` column says how far
// the repeats of a cell spread; when that is wider than the gaps between
// rows, the table cannot resolve what it was built to resolve, and it says so.
//
// Then a DOM-free microbenchmark puts an absolute ceiling on the other branch:
// if the R-tree search and the ink outline builder together cost microseconds
// at 50k, porting them buys microseconds.
import { genId, type DrawPoint, type Shape } from '@whiteboard/shared';
import { editor, spatialIndex } from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { generateKeyBetween } from './order';
import { quantizedCullRegion } from './geometry';
import { SpatialIndex } from './spatial-index';
import { getInkPathData } from './shapes/ink';

import {
  paintCounters,
  resetPaintCounters,
  useBenchFlags,
} from './bench-flags';
import { applyLowGraphics } from './use-canvas-ui-store';
import {
  auditRun,
  type Column,
  dataLine,
  headerLine,
  machineLine,
  measureRefreshMs,
  mean,
  median,
  medianFields,
  quantile,
  repeatInterleaved,
  residuals,
  settle,
  spread,
  waitForIdle,
  whenVisible,
} from './bench-stats';

const FRAMES = 120;
const WARMUP = 20;
/** Repeats of each table. */
const REPS = 3;

/** World units between seeded strokes. Fixed across counts, so a bigger page
 *  spreads further out instead of packing denser — shapes ON SCREEN stay
 *  roughly constant while shapes MOUNTED grow. That separation is the point. */
const GRID_SPACING = 60;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A 30-point wandering stroke, the shape of a real handwriting mark. */
function strokePoints(rnd: () => number): DrawPoint[] {
  const points: DrawPoint[] = [];
  let x = 0;
  let y = 0;
  let a = rnd() * 6.28;
  for (let p = 0; p < 30; p++) {
    a += (rnd() - 0.5) * 1.2;
    x += Math.cos(a) * 6;
    y += Math.sin(a) * 6;
    points.push({ x, y, pressure: 0.4 + 0.4 * rnd() });
  }
  return points;
}

/**
 * Lay `n` strokes on a square grid centred on the origin.
 *
 * A grid, not a random scatter: random placement makes the visible count a
 * lottery that varies between counts, and then a sweep is comparing two things
 * at once. With a fixed spacing every run in the sweep sees the same density
 * under the same camera, and the only variable left is how many shapes exist
 * off screen.
 */
function seed(n: number, spacing = GRID_SPACING): number {
  const rnd = rng(987654321);
  const side = Math.ceil(Math.sqrt(n));
  const half = (side * spacing) / 2;
  let index = generateKeyBetween(null, null);
  const shapes: Shape[] = [];
  for (let i = 0; i < n; i++) {
    shapes.push({
      id: genId(),
      type: 'draw',
      x: (i % side) * spacing - half,
      y: Math.floor(i / side) * spacing - half,
      rotation: 0,
      opacity: 1,
      index,
      props: {
        points: strokePoints(rnd),
        isClosed: false,
        color: '#1c1917',
        size: 4,
        simulatePressure: true,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      },
    } as Shape);
    index = generateKeyBetween(index, null);
  }
  const t0 = performance.now();
  editor.transact(() => {
    for (const s of shapes) editor.createShape(s);
  });
  return performance.now() - t0;
}

function clear(): void {
  const ids = editor.getShapes().map((s) => s.id);
  editor.transact(() => editor.deleteShapes(ids));
}

// ---------------------------------------------------------------------------
// Instrumentation
// ---------------------------------------------------------------------------

/** Time spent inside `spatialIndex.search` during the current frame. */
let cullMs = 0;
let lastHits = 0;

interface PatchableIndex {
  search: (b: unknown) => string[];
  __benchOriginal?: (b: unknown) => string[];
}

/**
 * Wrap `spatialIndex.search` with a timer, and hand back the undo.
 *
 * The wrapper costs two `performance.now()` calls per search, which is small
 * but not nothing, and it used to be installed permanently — so every run
 * after the first was measured through instrumentation left behind by the one
 * before, and so was any hand-driven poking around afterwards. Each entry
 * point below installs it for its own duration and takes it back off.
 */
function instrumentCull(): () => void {
  const index = spatialIndex as unknown as PatchableIndex;
  if (index.__benchOriginal) return () => {};
  const original = index.search.bind(spatialIndex);
  index.__benchOriginal = original;
  index.search = (bounds: unknown) => {
    const t0 = performance.now();
    const hits = original(bounds as never);
    cullMs += performance.now() - t0;
    lastHits = hits.length;
    return hits;
  };
  return () => {
    if (!index.__benchOriginal) return;
    index.search = index.__benchOriginal;
    delete index.__benchOriginal;
  };
}

/** What the shape tile cache is currently showing, or 'absent' when the host
 *  element is not in the DOM at all — which is what `rasterCache=off` and every
 *  gated-out engine look like, and is not the same as the cache deciding to
 *  stay live. */
function rasterState(): string {
  const host = document.querySelector<HTMLElement>('[data-shape-raster-cache]');
  return host?.dataset.rasterState ?? 'absent';
}

function rasterCounters(): { tiles: number; paints: number } {
  const host = document.querySelector<HTMLElement>('[data-shape-raster-cache]');
  return {
    tiles: Number(host?.dataset.rasterTiles ?? 0),
    paints: Number(host?.dataset.rasterPaints ?? 0),
  };
}

function domStats() {
  const shapeNodes = document.querySelectorAll('[data-shape-id]').length;
  const visibleNodes = [
    ...document.querySelectorAll<HTMLElement>('[data-shape-id]'),
  ].filter((el) => el.style.display !== 'none').length;
  const memory = (
    performance as unknown as { memory?: { usedJSHeapSize: number } }
  ).memory;
  return {
    total: document.getElementsByTagName('*').length,
    shapeNodes,
    visibleNodes,
    heapMb: memory ? memory.usedJSHeapSize / 1048576 : 0,
    // Published by the harness entry, which wraps the camera store's
    // `subscribe`. Every mounted shape's LOD hooks add listeners here.
    cameraSubs:
      (globalThis as unknown as { cameraSubscribers?: number })
        .cameraSubscribers ?? 0,
  };
}

// ---------------------------------------------------------------------------
// One scripted ramp
// ---------------------------------------------------------------------------

interface RunResult {
  frames: number[];
  js: number[];
  cull: number[];
  /** The Canvas2D paint split, one sample per frame. All four read 0 under
   *  `dom-svg`, which does not paint through this path — the same way `cull`
   *  reading 0.000 names a renderer that never queried the spatial index. */
  collect: number[];
  sort: number[];
  condition: number[];
  draw: number[];
  /** Shapes the cull search returned, sampled once per frame. */
  hits: number[];
  /** `data-raster-state` per frame: 'cached' | 'live' | 'unsupported' |
   *  'disabled' | 'absent'. Sampled every frame because the tile cache warms
   *  asynchronously: a ramp that spent half its frames waiting on rasterization
   *  and half on bitmaps must not be reported as a measurement of bitmaps. */
  raster: string[];
}

function ramp(mode: 'pan' | 'zoom'): Promise<RunResult> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    const js: number[] = [];
    const cull: number[] = [];
    const collect: number[] = [];
    const sortT: number[] = [];
    const condition: number[] = [];
    const draw: number[] = [];
    const hits: number[] = [];
    const raster: string[] = [];
    const store = useCameraStore.getState();
    const anchor = { x: innerWidth / 2, y: innerHeight / 2 };
    // Cleared per run, so a config that never searches — `-shapes`, whose
    // layer is unmounted — reports 0 rather than inheriting the count from
    // whichever config ran before it.
    lastHits = 0;
    let i = 0;
    let last = performance.now();
    const step = (now: number) => {
      frames.push(now - last);
      last = now;
      cullMs = 0;
      resetPaintCounters();
      const t0 = performance.now();
      if (mode === 'zoom') {
        const dir = Math.floor(i / 40) % 2 === 0 ? 1 / 1.04 : 1.04;
        store.zoomAtScreen(anchor, useCameraStore.getState().camera.z * dir);
      } else {
        store.panByScreen(7, 5);
      }
      js.push(performance.now() - t0);
      cull.push(cullMs);
      collect.push(paintCounters.collectMs);
      sortT.push(paintCounters.sortMs);
      condition.push(paintCounters.conditionMs);
      draw.push(paintCounters.drawMs);
      // Sampled every frame, not read once at the end. The visible count
      // moves across a ramp — a zoom ramp changes it by an order of magnitude
      // — so the last frame's value described one frame and was printed as
      // though it described the run.
      hits.push(lastHits);
      // After the `js` clock has stopped, so reading it cannot be mistaken for
      // work the renderer did.
      raster.push(rasterState());
      i++;
      if (i < FRAMES + WARMUP) requestAnimationFrame(step);
      else
        resolve({
          frames: frames.slice(WARMUP),
          js: js.slice(WARMUP),
          cull: cull.slice(WARMUP),
          collect: collect.slice(WARMUP),
          sort: sortT.slice(WARMUP),
          condition: condition.slice(WARMUP),
          draw: draw.slice(WARMUP),
          hits: hits.slice(WARMUP),
          raster: raster.slice(WARMUP),
        });
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** What one run of one cell contributes to its row. */
interface RampStats {
  fps: number;
  frameMed: number;
  frameP95: number;
  jsMed: number;
  jsP95: number;
  /** Per-frame `frame - js`: the browser's share. The headline number. */
  browserMed: number;
  cullMed: number;
  collectMed: number;
  sortMed: number;
  conditionMed: number;
  /** Per-frame `draw - condition`: placing and filling paths that were already
   *  built — one `setTransform` and one `fill` per shape, plus the cache
   *  lookup. The batchable budget, and the number the batching decision turns
   *  on. Differenced per frame like `browser`, never median from median. */
  fillMed: number;
  hitsMed: number;
}

function statsOf(r: RunResult): RampStats {
  return {
    fps: 1000 / mean(r.frames),
    frameMed: median(r.frames),
    frameP95: quantile(r.frames, 0.95),
    jsMed: median(r.js),
    jsP95: quantile(r.js, 0.95),
    browserMed: median(residuals(r.frames, r.js)),
    cullMed: median(r.cull),
    collectMed: median(r.collect),
    sortMed: median(r.sort),
    conditionMed: median(r.condition),
    fillMed: median(residuals(r.draw, r.condition)),
    hitsMed: median(r.hits),
  };
}

const LABEL_WIDTH = 20;

// One list, used for both the header and every row; `dataLine` throws on a row
// that disagrees with it, so a column can never be printed under the wrong
// heading.
const COLUMNS: Column[] = [
  { head: 'fps', width: 4 },
  { head: 'frame', width: 7 },
  { head: 'p95', width: 7 },
  { head: 'js', width: 7 },
  { head: 'jsp95', width: 7 },
  { head: 'browser', width: 8 },
  { head: 'rep±', width: 5 },
  { head: 'cull', width: 7 },
  { head: 'collect', width: 8 },
  { head: 'sort', width: 6 },
  { head: 'cond', width: 7 },
  { head: 'fill', width: 7 },
  { head: 'vis', width: 6 },
];

const HEAD = headerLine('run', LABEL_WIDTH, COLUMNS);

function row(label: string, reps: readonly RampStats[]): string {
  const s = medianFields(reps);
  const repSpread = spread(reps.map((r) => r.frameMed));
  return dataLine(label, LABEL_WIDTH, COLUMNS, [
    s.fps.toFixed(0),
    s.frameMed.toFixed(1),
    s.frameP95.toFixed(1),
    s.jsMed.toFixed(2),
    s.jsP95.toFixed(2),
    s.browserMed.toFixed(1),
    `${(100 * repSpread).toFixed(0)}%`,
    s.cullMed.toFixed(3),
    s.collectMed.toFixed(2),
    s.sortMed.toFixed(2),
    s.conditionMed.toFixed(2),
    s.fillMed.toFixed(2),
    s.hitsMed.toFixed(0),
  ]);
}

// ---------------------------------------------------------------------------
// DOM-free microbenchmark — the ceiling on any language port
// ---------------------------------------------------------------------------

// Every timed loop below feeds its result into this. A loop whose result is
// discarded is a loop the engine is entitled to delete, and a deleted loop
// benchmarks at zero — which would be reported here as "free".
let sink = 0;

function microbench(n: number): string[] {
  const rnd = rng(24680);
  const side = Math.ceil(Math.sqrt(n));
  const half = (side * GRID_SPACING) / 2;
  const items = [];
  for (let i = 0; i < n; i++) {
    const x = (i % side) * GRID_SPACING - half;
    const y = Math.floor(i / side) * GRID_SPACING - half;
    items.push({ id: `s${i}`, minX: x, minY: y, maxX: x + 50, maxY: y + 50 });
  }

  const index = new SpatialIndex();
  const tLoad = performance.now();
  index.loadAll(items);
  const loadMs = performance.now() - tLoad;

  const camera = { x: 0, y: 0, z: 1 };
  const region = quantizedCullRegion(camera, 1400, 900);

  // Warm the JIT before the timed loop, or the first iterations are measuring
  // the interpreter rather than the code.
  for (let i = 0; i < 200; i++) sink += index.search(region).length;
  const ITER = 2000;
  const tSearch = performance.now();
  let hits = 0;
  for (let i = 0; i < ITER; i++) hits = index.search(region).length;
  const searchUs = ((performance.now() - tSearch) / ITER) * 1000;
  sink += hits;

  const tRegion = performance.now();
  for (let i = 0; i < 100000; i++)
    sink += quantizedCullRegion(
      { x: i, y: i, z: 1 + (i % 7) / 10 },
      1400,
      900,
    ).minX;
  const regionUs = ((performance.now() - tRegion) / 100000) * 1000;

  // The set construction the scene does with the search result each frame.
  const ids = index.search(region);
  const tSet = performance.now();
  for (let i = 0; i < ITER; i++) sink += new Set(ids).size;
  const setUs = ((performance.now() - tSet) / ITER) * 1000;

  // Stroke outline generation — the "curve fitting / simplification" work.
  const points = strokePoints(rnd);
  const dynamics = {
    simulatePressure: true,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  };
  for (let i = 0; i < 200; i++)
    sink += getInkPathData(points, 4, true, dynamics).length;
  const tInk = performance.now();
  for (let i = 0; i < ITER; i++)
    sink += getInkPathData(points, 4, true, dynamics).length;
  const inkUs = ((performance.now() - tInk) / ITER) * 1000;

  (globalThis as unknown as { __benchSink?: number }).__benchSink = sink;
  return [
    `microbench (no DOM), n=${n}`,
    `  rbush bulk load ${n}          ${loadMs.toFixed(1)} ms  (once, on page load)`,
    `  rbush search -> ${hits} hits   ${searchUs.toFixed(1)} us/call`,
    `  quantizedCullRegion           ${regionUs.toFixed(3)} us/call`,
    `  new Set(${hits} ids)           ${setUs.toFixed(1)} us/call`,
    `  getInkPathData 30 pts         ${inkUs.toFixed(1)} us/stroke`,
  ];
}

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const HOME = { x: -700, y: -450, z: 1 };

/** Collects the repeats of one table, keyed by row label. */
class Table {
  private readonly cells = new Map<string, RampStats[]>();
  private readonly order: string[] = [];

  add(label: string, stats: RampStats): void {
    const existing = this.cells.get(label);
    if (existing) existing.push(stats);
    else {
      this.cells.set(label, [stats]);
      this.order.push(label);
    }
  }

  rows(): string[] {
    return this.order.map((label) => this.rowFor(label));
  }

  rowFor(label: string): string {
    return row(label, this.cells.get(label)!);
  }

  repMediansFor(label: string): number[] {
    return this.cells.get(label)!.map((s) => s.frameMed);
  }

  labels(): readonly string[] {
    return this.order;
  }

  warnings(driftPairs: readonly [string, string][] = []): string[] {
    return auditRun(
      this.order.map((label) => ({
        label,
        repMedians: this.cells.get(label)!.map((s) => s.frameMed),
      })),
      driftPairs,
    );
  }
}

export async function runScaleBench(
  counts: number[] = [1000, 5000, 20000, 50000],
  reps = REPS,
): Promise<string> {
  await whenVisible();
  const restoreCull = instrumentCull();

  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;' +
    'padding:10px 14px;font:11px/1.5 ui-monospace,monospace;white-space:pre;' +
    'pointer-events:none;max-width:98vw;max-height:96vh;overflow:hidden';
  document.body.append(box);
  box.textContent = 'measuring the display…';

  // Before any seeding, while the page is as quiet as it will ever be. Every
  // idle gate below is expressed as a multiple of this rather than the 18ms
  // that only means "one frame" on a 60Hz panel.
  const refreshMs = await measureRefreshMs();

  const lines: string[] = [machineLine(refreshMs), `reps ${reps}`, ''];
  const show = (extra = '') => {
    box.textContent = [...lines, extra].join('\n');
  };
  show('starting…');

  try {
    // --- Part 1: the scaling sweep ----------------------------------------
    lines.push(
      'SCALING SWEEP — same camera, same density, only the total grows',
    );
    lines.push(HEAD);
    show();

    const sweep = new Table();
    const notes = new Map<number, string>();
    for (let rep = 0; rep < reps; rep++) {
      for (const n of counts) {
        clear();
        await settle(200);
        show(`rep ${rep + 1}/${reps} — seeding ${n}…`);
        const seedMs = seed(n);
        useCameraStore.getState().setCamera(HOME);
        show(`seeded ${n} in ${seedMs.toFixed(0)}ms — waiting for idle…`);
        const quiet = await waitForIdle(refreshMs);
        if (!notes.has(n)) {
          const dom = domStats();
          notes.set(
            n,
            `-- ${n} shapes: seed ${seedMs.toFixed(0)}ms, ` +
              `${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ` +
              `${dom.total} DOM nodes, heap ${dom.heapMb.toFixed(0)}MB` +
              (quiet ? '' : '  [NEVER IDLE — SUSPECT]'),
          );
        }
        for (const mode of ['pan', 'zoom'] as const) {
          useCameraStore.getState().setCamera(HOME);
          await settle(300);
          await waitForIdle(refreshMs, { need: 20, timeoutMs: 8000 });
          show(`rep ${rep + 1}/${reps} — running ${n} ${mode}…`);
          sweep.add(`${n} ${mode}`, statsOf(await ramp(mode)));
          show();
        }
      }
    }
    // Interleave each count's note back in above its two rows.
    for (const n of counts) {
      lines.push(notes.get(n) ?? '');
      for (const mode of ['pan', 'zoom'] as const) {
        lines.push(sweep.rowFor(`${n} ${mode}`));
      }
    }
    lines.push(...sweep.warnings());
    show();

    // --- Part 2: subsystem A/B at the top count ---------------------------
    // The document is already seeded at the top count by the last pass of the
    // sweep above, and none of these configs touch it.
    const top = counts[counts.length - 1]!;
    lines.push('');
    lines.push(`SUBSYSTEM A/B at ${top} shapes (pan ramp)`);
    lines.push(HEAD);
    show();

    const configs: {
      name: string;
      flags?: Partial<{
        noBg: boolean;
        noShapes: boolean;
      }>;
      low?: boolean;
    }[] = [
      { name: 'baseline' },
      { name: '-background', flags: { noBg: true } },
      { name: '-glass ornament', low: true },
      { name: '-shapes', flags: { noShapes: true } },
      // Repeat of line one, run last in every pass. `auditRun` compares the
      // two and says so in the table when they disagree: that is drift in the
      // machine, and it makes noise of every other line here.
      { name: 'baseline#2' },
    ];
    const ab = new Table();
    for (let rep = 0; rep < reps; rep++) {
      for (const config of configs) {
        useBenchFlags.setState({
          noBg: false,
          noShapes: false,
          ...config.flags,
        });
        applyLowGraphics(!!config.low);
        useCameraStore.getState().setCamera(HOME);
        await settle(400);
        await waitForIdle(refreshMs, { need: 20, timeoutMs: 8000 });
        show(`rep ${rep + 1}/${reps} — running ${config.name}…`);
        ab.add(config.name, statsOf(await ramp('pan')));
        show();
      }
    }
    useBenchFlags.setState({
      noBg: false,
      noShapes: false,
    });
    applyLowGraphics(false);
    lines.push(...ab.rows());
    lines.push(...ab.warnings([['baseline', 'baseline#2']]));
    show();

    // --- Part 3: density A/B, total held at the top count -----------------
    lines.push('');
    lines.push(
      `DENSITY A/B — ${top} shapes either way, only how many are ON SCREEN changes`,
    );
    lines.push(HEAD);
    show();
    const densities = [
      ['spread 4x', GRID_SPACING * 4],
      ['dense 1x', GRID_SPACING],
    ] as const;
    const density = new Table();
    const densityNotes = new Map<string, string>();
    for (let rep = 0; rep < reps; rep++) {
      for (const [label, spacing] of densities) {
        clear();
        await settle(200);
        show(`rep ${rep + 1}/${reps} — re-seeding ${label}…`);
        seed(top, spacing);
        useCameraStore.getState().setCamera(HOME);
        await waitForIdle(refreshMs);
        if (!densityNotes.has(label)) {
          const dom = domStats();
          densityNotes.set(
            label,
            `-- ${label}: ${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
          );
        }
        density.add(label, statsOf(await ramp('pan')));
        show();
      }
    }
    for (const [label] of densities) {
      lines.push(densityNotes.get(label) ?? '');
      lines.push(density.rowFor(label));
    }
    lines.push(...density.warnings());
    show();

    // --- Part 4: the microbenchmark ---------------------------------------
    lines.push('');
    lines.push(...microbench(top));
    show();
  } finally {
    restoreCull();
  }

  const text = lines.join('\n');
  (globalThis as unknown as { __scaleBench?: string }).__scaleBench = text;
  return text;
}

// ---------------------------------------------------------------------------
// Subsystem A/B on its own
// ---------------------------------------------------------------------------

/**
 * The subsystem A/B at one shape count, with the repeats shown individually.
 *
 * Separate from the sweep because of what a repeat costs there. At 50k the
 * clear, the seed, the React mount and the idle gate together outweigh every
 * ramp in the matrix put together, and the sweep re-seeds for its scaling table
 * and again for each density cell — so asking it for three repeats of THIS
 * table means paying for nine seeds to get them. Here the scene is planted
 * once and every config pans across it.
 *
 * The config list is deliberately not the sweep's. `baseline` runs three times
 * before anything is switched off, because the behaviour this table is chasing
 * — DOM/SVG pan reading 66.7ms early in a session and 16.7ms later in the same
 * one, which the drift check caught and refused to average — has two candidate
 * causes the sweep's ordering cannot separate: a warm-up that completes after a
 * few ramps, or a state that unmounting the shape layer resets. Consecutive
 * baselines separate them. Expensive then cheap with nothing switched off is
 * warm-up; expensive until `-shapes` has run is the unmount.
 *
 * Per-rep medians are printed, not just their spread: a cell whose repeats read
 * 66.7 / 16.7 / 16.7 and one whose repeats read 33 / 33 / 33 have a similar
 * median and mean completely different things.
 */
export async function runSubsystemAb(count = 50000, reps = 3): Promise<string> {
  await whenVisible();
  const restoreCull = instrumentCull();

  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;' +
    'padding:10px 14px;font:11px/1.5 ui-monospace,monospace;white-space:pre;' +
    'pointer-events:none;max-width:98vw;max-height:96vh;overflow:hidden';
  document.body.append(box);
  box.textContent = 'measuring the display…';

  const refreshMs = await measureRefreshMs();
  const lines: string[] = [machineLine(refreshMs), ''];
  const show = (extra = '') => {
    box.textContent = [...lines, extra].join('\n');
  };

  try {
    clear();
    await settle(200);
    show(`seeding ${count}…`);
    const seedMs = seed(count);
    useCameraStore.getState().setCamera(HOME);
    show(`seeded in ${seedMs.toFixed(0)}ms — waiting for idle…`);
    const quiet = await waitForIdle(refreshMs);
    const dom = domStats();

    lines.push(
      `SUBSYSTEM A/B at ${count} shapes (pan ramp), ${reps} reps, one seeding`,
    );
    lines.push(
      `-- seed ${seedMs.toFixed(0)}ms, ${dom.shapeNodes} containers, ` +
        `${dom.visibleNodes} shown, ${dom.total} DOM nodes, ` +
        `heap ${dom.heapMb.toFixed(0)}MB` +
        (quiet ? '' : '  [NEVER IDLE — SUSPECT]'),
    );
    lines.push(HEAD);
    show();

    const configs: {
      name: string;
      flags?: Partial<{ noBg: boolean; noShapes: boolean }>;
      low?: boolean;
    }[] = [
      { name: 'baseline' },
      { name: 'baseline#2' },
      { name: 'baseline#3' },
      { name: '-background', flags: { noBg: true } },
      { name: 'baseline#4' },
      { name: '-glass ornament', low: true },
      { name: 'baseline#5' },
      { name: '-shapes', flags: { noShapes: true } },
      { name: 'baseline#6' },
    ];

    const table = new Table();
    for (let rep = 0; rep < reps; rep++) {
      for (const config of configs) {
        useBenchFlags.setState({
          noBg: false,
          noShapes: false,
          ...config.flags,
        });
        applyLowGraphics(!!config.low);
        useCameraStore.getState().setCamera(HOME);
        await settle(400);
        await waitForIdle(refreshMs, { need: 20, timeoutMs: 8000 });
        show(`rep ${rep + 1}/${reps} — running ${config.name}…`);
        table.add(config.name, statsOf(await ramp('pan')));
        show();
      }
    }
    useBenchFlags.setState({ noBg: false, noShapes: false });
    applyLowGraphics(false);

    lines.push(...table.rows());
    lines.push('');
    lines.push('per-rep frame medians (ms), in the order they ran');
    for (const label of table.labels()) {
      lines.push(
        label.padEnd(LABEL_WIDTH) +
          table
            .repMediansFor(label)
            .map((v) => v.toFixed(1).padStart(8))
            .join(''),
      );
    }
    lines.push(
      ...table.warnings([
        ['baseline', 'baseline#2'],
        ['baseline', 'baseline#6'],
      ]),
    );
    show();
  } finally {
    restoreCull();
  }

  const text = lines.join('\n');
  (globalThis as unknown as { __subsystemAb?: string }).__subsystemAb = text;
  return text;
}

// ---------------------------------------------------------------------------
// Raster tile cache break-even
// ---------------------------------------------------------------------------
//
// `shouldCacheShapes` ships `Firefox && visible >= 200` (raster-grid.ts), and
// both the comment above it and RASTER_CACHE.md say plainly that 200 is a
// conservative guess carried over from an earlier snapshot experiment rather
// than a measured break-even. This finds the real one.
//
// The axis is VISIBLE shapes, because that is what the gate reads — not the
// document total. So the total is held fixed and the grid spacing is varied:
// a tighter grid puts more strokes under the same viewport while the mount
// cost, the heap and the spatial index stay where they were. Reporting the
// measured visible count next to each row is what makes the threshold readable
// off the table instead of inferred from the spacing.
//
// ONE MODE PER PAGE LOAD. `useShapeRasterCache` reads `?rasterCache=` once, in
// a layout effect, so on and off cannot be interleaved inside a run the way the
// subsystem configs can — flipping it needs a reload. This entry therefore
// measures whichever mode the URL selected, and the driver alternates reloads
// and interleaves at that level. The cost of that is real: a reload resets the
// JIT, the heap and the DOM-SVG pan hysteresis (see `runSubsystemAb`), so
// on-vs-off carries per-reload drift that no in-page check can catch. Compare
// modes only across reloads that alternated.
//
// `cached%` is the honesty column. The tile cache rasterizes asynchronously and
// shows live SVG until a zoom level covers the viewport, so a ramp can easily
// spend most of its frames not actually using bitmaps. A fast row with a low
// `cached%` is not evidence about the cache; it is evidence the cache never
// engaged.

/** Grid spacing, in world units, that puts roughly `target` strokes under the
 *  viewport at z=1 — where one world unit is one CSS pixel. */
function spacingForVisible(target: number): number {
  return Math.max(8, Math.sqrt((innerWidth * innerHeight) / target));
}

interface RasterStats {
  visMed: number;
  fps: number;
  frameMed: number;
  frameP95: number;
  jsMed: number;
  browserMed: number;
  cachedPct: number;
  tiles: number;
  paints: number;
}

function rasterStatsOf(r: RunResult, paintsDelta: number): RasterStats {
  return {
    visMed: median(r.hits),
    fps: 1000 / mean(r.frames),
    frameMed: median(r.frames),
    frameP95: quantile(r.frames, 0.95),
    jsMed: median(r.js),
    browserMed: median(residuals(r.frames, r.js)),
    cachedPct:
      (100 * r.raster.filter((v) => v === 'cached').length) /
      Math.max(1, r.raster.length),
    tiles: rasterCounters().tiles,
    paints: paintsDelta,
  };
}

const RASTER_COLUMNS: Column[] = [
  { head: 'vis', width: 6 },
  { head: 'fps', width: 4 },
  { head: 'frame', width: 7 },
  { head: 'p95', width: 7 },
  { head: 'js', width: 6 },
  { head: 'browser', width: 8 },
  { head: 'cached%', width: 7 },
  { head: 'tiles', width: 5 },
  { head: 'paints', width: 6 },
  { head: 'rep±', width: 5 },
];

const RASTER_HEAD = headerLine('run', LABEL_WIDTH, RASTER_COLUMNS);

function rasterRow(label: string, reps: readonly RasterStats[]): string {
  const s = medianFields(reps);
  return dataLine(label, LABEL_WIDTH, RASTER_COLUMNS, [
    s.visMed.toFixed(0),
    s.fps.toFixed(0),
    s.frameMed.toFixed(1),
    s.frameP95.toFixed(1),
    s.jsMed.toFixed(2),
    s.browserMed.toFixed(1),
    s.cachedPct.toFixed(0),
    s.tiles.toFixed(0),
    s.paints.toFixed(0),
    `${(100 * spread(reps.map((r) => r.frameMed))).toFixed(0)}%`,
  ]);
}

/** Targets bracketing the shipped `visible >= 200` gate on both sides. */
const VISIBLE_TARGETS = [50, 100, 200, 400, 800, 1600];

export async function runRasterSweep(
  targets: number[] = VISIBLE_TARGETS,
  total = 20000,
  reps = 3,
): Promise<string> {
  await whenVisible();
  const restoreCull = instrumentCull();

  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;' +
    'padding:10px 14px;font:11px/1.5 ui-monospace,monospace;white-space:pre;' +
    'pointer-events:none;max-width:98vw;max-height:96vh;overflow:hidden';
  document.body.append(box);
  box.textContent = 'measuring the display…';

  const refreshMs = await measureRefreshMs();
  const requested =
    new URLSearchParams(location.search).get('rasterCache') ?? 'auto';
  const lines: string[] = [
    machineLine(refreshMs),
    `RASTER CACHE — rasterCache=${requested}, ${total} shapes total, ` +
      `${reps} reps, axis is VISIBLE count`,
    'A row with a low cached% did not use bitmaps; it is not evidence about them.',
    '',
    RASTER_HEAD,
  ];
  const show = (extra = '') => {
    box.textContent = [...lines, extra].join('\n');
  };
  show();

  try {
    const cells = new Map<string, RasterStats[]>();
    const order: string[] = [];
    const notes = new Map<string, string>();
    const add = (label: string, st: RasterStats) => {
      const list = cells.get(label);
      if (list) list.push(st);
      else {
        cells.set(label, [st]);
        order.push(label);
      }
    };

    for (let rep = 0; rep < reps; rep++) {
      for (const target of targets) {
        const spacing = spacingForVisible(target);
        clear();
        await settle(200);
        show(`rep ${rep + 1}/${reps} — seeding ~${target} visible…`);
        seed(total, spacing);
        useCameraStore.getState().setCamera(HOME);
        // The cache prepares tiles at rest, so this gate is also what gives it
        // a chance to warm. Without it the first ramp of every cell measures
        // rasterization instead of the bitmaps it produces.
        const quiet = await waitForIdle(refreshMs);
        if (!notes.has(String(target))) {
          const dom = domStats();
          notes.set(
            String(target),
            `-- target ${target} visible: spacing ${spacing.toFixed(0)}, ` +
              `${dom.visibleNodes} shown of ${dom.shapeNodes} containers, ` +
              `state ${rasterState()}, heap ${dom.heapMb.toFixed(0)}MB` +
              (quiet ? '' : '  [NEVER IDLE — SUSPECT]'),
          );
        }
        for (const mode of ['pan', 'zoom'] as const) {
          useCameraStore.getState().setCamera(HOME);
          await settle(400);
          await waitForIdle(refreshMs, { need: 20, timeoutMs: 8000 });
          show(`rep ${rep + 1}/${reps} — ${target} visible, ${mode}…`);
          const before = rasterCounters().paints;
          const result = await ramp(mode);
          add(
            `${target} ${mode}`,
            rasterStatsOf(result, rasterCounters().paints - before),
          );
          show();
        }
      }
    }

    for (const target of targets) {
      lines.push(notes.get(String(target)) ?? '');
      for (const mode of ['pan', 'zoom'] as const) {
        const label = `${target} ${mode}`;
        lines.push(rasterRow(label, cells.get(label)!));
      }
    }
    lines.push(
      ...auditRun(
        order.map((label) => ({
          label,
          repMedians: cells.get(label)!.map((s) => s.frameMed),
        })),
        [],
      ),
    );
    show();
  } finally {
    restoreCull();
  }

  const text = lines.join('\n');
  (globalThis as unknown as { __rasterSweep?: string }).__rasterSweep = text;
  return text;
}

// ---------------------------------------------------------------------------
// rAF-free path
// ---------------------------------------------------------------------------
//
// A hidden tab gets no `requestAnimationFrame` at all, so the ramp above
// cannot run there — and frame timings from a tab the compositor is not
// presenting would not mean anything if it could. This path measures the same
// split without the frame loop:
//
//   js      — the camera store update and every signal effect it runs, which
//             is all of our own per-frame work: cull search, presentation
//             recompute, transform writes.
//   layout  — the browser's style recalc and layout for that change, forced
//             synchronously by reading a layout property straight after.
//
// It excludes paint and composite, so it UNDERSTATES the browser side. That
// is the safe direction: if style and layout alone already dwarf our JS, the
// full frame only widens the gap.

interface StaticStats {
  jsMed: number;
  jsP95: number;
  layoutMed: number;
  layoutP95: number;
  cullMed: number;
  hitsMed: number;
}

function staticSteps(steps = 120): StaticStats {
  const store = useCameraStore.getState();
  const js: number[] = [];
  const layout: number[] = [];
  const cull: number[] = [];
  const hits: number[] = [];
  const probe = document.querySelector('[data-shape-layer]') ?? document.body;
  lastHits = 0;
  for (let i = 0; i < steps; i++) {
    cullMs = 0;
    const t0 = performance.now();
    store.panByScreen(7, 5);
    const t1 = performance.now();
    // Forces style recalc + layout for everything the camera change dirtied.
    void (probe as HTMLElement).getBoundingClientRect().width;
    void document.body.offsetHeight;
    const t2 = performance.now();
    if (i >= 20) {
      js.push(t1 - t0);
      layout.push(t2 - t1);
      cull.push(cullMs);
      hits.push(lastHits);
    }
  }
  return {
    jsMed: median(js),
    jsP95: quantile(js, 0.95),
    layoutMed: median(layout),
    layoutP95: quantile(layout, 0.95),
    cullMed: median(cull),
    hitsMed: median(hits),
  };
}

const STATIC_COLUMNS: Column[] = [
  { head: 'js', width: 7 },
  { head: 'jsp95', width: 7 },
  { head: 'layout', width: 8 },
  { head: 'lay.p95', width: 8 },
  { head: 'rep±', width: 5 },
  { head: 'cull', width: 7 },
  { head: 'vis', width: 6 },
];

const STATIC_HEAD = headerLine('run', LABEL_WIDTH, STATIC_COLUMNS);

function staticRow(label: string, reps: readonly StaticStats[]): string {
  const s = medianFields(reps);
  const repSpread = spread(reps.map((r) => r.jsMed));
  return dataLine(label, LABEL_WIDTH, STATIC_COLUMNS, [
    s.jsMed.toFixed(2),
    s.jsP95.toFixed(2),
    s.layoutMed.toFixed(2),
    s.layoutP95.toFixed(2),
    `${(100 * repSpread).toFixed(0)}%`,
    s.cullMed.toFixed(3),
    s.hitsMed.toFixed(0),
  ]);
}

/**
 * The sweep, without any dependency on the tab being presented.
 *
 * Async only to let React commit. Seeding publishes a new id list, and React
 * schedules that work on a macrotask; reading the DOM in the same tick would
 * count the nodes of the PREVIOUS run.
 */
export async function runStaticBench(
  counts: number[] = [1000, 5000, 20000, 50000],
  reps = REPS,
): Promise<string> {
  const restoreCull = instrumentCull();
  const lines: string[] = [
    // No `machineLine`: measuring the refresh rate needs rAF, and this path
    // exists precisely for tabs that do not get it.
    `${navigator.userAgent}`,
    `reps ${reps}  ${new Date().toISOString()}`,
    'STATIC SWEEP — no rAF. js = our code; layout = forced style+layout.',
    'Paint and composite are NOT included, so `layout` understates the browser.',
    '',
    STATIC_HEAD,
  ];
  try {
    const sweep = new Map<string, StaticStats[]>();
    const notes = new Map<number, string>();
    const push = (label: string, s: StaticStats) => {
      const list = sweep.get(label);
      if (list) list.push(s);
      else sweep.set(label, [s]);
    };
    for (let rep = 0; rep < reps; rep++) {
      for (const n of counts) {
        clear();
        await settle(150);
        const seedMs = seed(n);
        await settle(400);
        useCameraStore.getState().setCamera(HOME);
        void document.body.offsetHeight;
        await settle(150);
        if (!notes.has(n)) {
          const dom = domStats();
          notes.set(
            n,
            `-- ${n} shapes: seed ${seedMs.toFixed(0)}ms, ` +
              `${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ` +
              `${dom.total} DOM nodes, ${dom.cameraSubs} camera subs, ` +
              `heap ${dom.heapMb.toFixed(0)}MB`,
          );
        }
        push(`${n} pan`, staticSteps());
      }
    }
    for (const n of counts) {
      lines.push(notes.get(n) ?? '');
      lines.push(staticRow(`${n} pan`, sweep.get(`${n} pan`)!));
    }

    // Density A/B: the total is held constant, only how many shapes are on
    // screen changes. If the numbers barely move, the cost is being paid by
    // shapes that are mounted and hidden, not by shapes being drawn.
    const top = counts[counts.length - 1]!;
    lines.push('');
    lines.push(`DENSITY A/B — ${top} shapes either way`);
    lines.push(STATIC_HEAD);
    const densities = [
      ['spread 4x', GRID_SPACING * 4],
      ['dense 1x', GRID_SPACING],
    ] as const;
    const density = new Map<string, StaticStats[]>();
    const densityNotes = new Map<string, string>();
    const pushDensity = (label: string, st: StaticStats) => {
      const list = density.get(label);
      if (list) list.push(st);
      else density.set(label, [st]);
    };
    for (let rep = 0; rep < reps; rep++) {
      for (const [label, spacing] of densities) {
        clear();
        await settle(150);
        seed(top, spacing);
        await settle(400);
        useCameraStore.getState().setCamera(HOME);
        void document.body.offsetHeight;
        await settle(150);
        if (!densityNotes.has(label)) {
          const dom = domStats();
          densityNotes.set(
            label,
            `-- ${label}: ${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
          );
        }
        pushDensity(label, staticSteps());
      }
    }
    for (const [label] of densities) {
      lines.push(densityNotes.get(label) ?? '');
      lines.push(staticRow(label, density.get(label)!));
    }

    lines.push('');
    lines.push(...microbench(top));
  } finally {
    restoreCull();
  }
  const text = lines.join('\n');
  (globalThis as unknown as { __scaleBench?: string }).__scaleBench = text;
  return text;
}

// ---------------------------------------------------------------------------
// Attribution
// ---------------------------------------------------------------------------
//
// The sweep says the per-step cost is ours and grows with the number of shapes
// MOUNTED, not the number DRAWN. This narrows that to a subsystem by driving
// each layer of the stack on its own, at a fixed shape count:
//
//   store       the whole pan: zustand notify -> scene.camera -> signal
//               effects -> React. What the sweep measured.
//   scene       scene.camera.set() alone. Skips zustand and React; runs the
//               signal graph and its effects.
//   visible     forcing the cull computed to recompute, alone.
//   presentation  recomputing one node's transform/clip/opacity, alone.
//   -shapes     the pan with the shape layer unmounted entirely.
//
// `store` minus `scene` is zustand and React. `scene` minus `visible` is the
// effects the camera atom drives. Anything left over is the signal graph's own
// bookkeeping across however many nodes exist.

interface CanvasSceneLike {
  camera: { set: (c: unknown) => void; get: () => unknown };
  visible: { get: () => Set<string> };
  viewport: { get: () => { width: number; height: number } };
  ids: { get: () => readonly string[] };
  boundsEpoch: { update: (f: (n: number) => number) => void };
  /** Read by `canvas-2d-renderer`'s paint and by nothing else on the page, so
   *  bumping it buys exactly one full repaint — see `runRepaintBench`. */
  uiEpoch: { update: (f: (n: number) => number) => void };
  record: (id: string) => { presentation: { get: () => unknown } };
}

function theScene(): CanvasSceneLike | undefined {
  return (globalThis as unknown as { __scene?: CanvasSceneLike }).__scene;
}

/** Median of `fn` over `n` timed calls, warm-up discarded. */
function medianOf(n: number, fn: (i: number) => void): number {
  for (let i = 0; i < 10; i++) fn(i);
  const samples: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    fn(i);
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

export async function runAttribution(count = 50000): Promise<string> {
  const restoreCull = instrumentCull();
  try {
    const lines: string[] = [
      `ATTRIBUTION at ${count} shapes — median ms per call`,
    ];
    clear();
    await settle(200);
    const seedMs = seed(count);
    await settle(600);
    useCameraStore.getState().setCamera(HOME);
    await settle(400);

    const scene = theScene();
    if (!scene) return 'no scene published';
    const dom = domStats();
    lines.push(
      `-- ${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ` +
        `${dom.total} DOM nodes, heap ${dom.heapMb.toFixed(0)}MB, seed ${seedMs.toFixed(0)}ms`,
    );

    const store = useCameraStore.getState();
    lines.push(
      `store  (full pan step)      ${medianOf(120, () => store.panByScreen(7, 5)).toFixed(2)}`,
    );

    let cx = 0;
    lines.push(
      `scene  (camera.set only)    ${medianOf(120, () => {
        cx += 7;
        scene.camera.set({ x: -700 + cx, y: -450, z: 1 });
      }).toFixed(2)}`,
    );

    lines.push(
      `visible (forced recompute)  ${medianOf(120, () => {
        // boundsEpoch is a dependency of `visible`, so bumping it forces the
        // computed to re-run without moving the camera.
        scene.boundsEpoch.update((n) => n + 1);
        scene.visible.get();
      }).toFixed(3)}`,
    );

    const ids = scene.ids.get();
    lines.push(
      `presentation (1 node)       ${(
        medianOf(200, (i) => {
          scene.record(ids[i % ids.length]!).presentation.get();
        }) * 1000
      ).toFixed(1)} us`,
    );

    useBenchFlags.setState({
      noBg: false,
      noShapes: true,
    });
    await settle(800);
    lines.push(
      `-shapes (layer unmounted)   ${medianOf(120, () => store.panByScreen(7, 5)).toFixed(2)}`,
    );
    useBenchFlags.setState({
      noBg: false,
      noShapes: false,
    });
    await settle(800);
    lines.push(
      `baseline#2                  ${medianOf(120, () => store.panByScreen(7, 5)).toFixed(2)}`,
    );

    const text = lines.join('\n');
    (globalThis as unknown as { __attr?: string }).__attr = text;
    return text;
  } finally {
    restoreCull();
  }
}

// ---------------------------------------------------------------------------
// Full repaint
// ---------------------------------------------------------------------------
//
// Every ramp above drives a gesture, and a gesture is the one case
// `canvas-2d-renderer` does NOT repaint for: a pan shifts the existing bitmap,
// a zoom rescales it, and only the strip that reprojection left uncovered is
// drawn again. So the ramps' `vis` column counts an edge strip, their `fill`
// column prices an edge strip, and the branch that draws the WHOLE viewport
// has never appeared in a table — even though a settle, an edit, a theme flip
// and a resize all take it, and at 25k shapes it is the candidate for a
// visible hitch.
//
// Driving that branch is one line. `uiEpoch` is a tracked read in `paint` and
// is read nowhere else in the app, so bumping it invalidates the cached frame
// and nothing else: a full repaint at a camera that has not moved, with no
// React commit and no geometry change riding along. Warm-up matters more here
// than elsewhere — the first repaint after a seed builds every ink outline in
// the viewport, and `conditionMs` is meant to read ~0 once the cache is warm,
// which is what a settle repaint actually costs.
//
// No rAF, for the reason `runAttribution` uses none: this asks how long our JS
// runs, not what fits in a frame, and a throttled tab answers the first
// question exactly as well as a presented one.
//
// Two columns are the point:
//   `drawn`  shapes actually painted — the number the gesture ramps could not
//            report, because theirs described a strip.
//   `blits`  must stay 0 for the whole run. Anything else means a reprojection
//            slipped in and the branch under test was not the one measured.

interface RepaintStats {
  totalMed: number;
  totalP95: number;
  collectMed: number;
  sortMed: number;
  conditionMed: number;
  /** `draw - condition`: placing and filling paths already built. One
   *  `setTransform` and one `stroke`/`fill` per shape, plus the cache lookup —
   *  the budget a batched, chunk-keyed path would compete against. */
  fillMed: number;
  drawnMed: number;
  blits: number;
}

/** The canvas the 2d renderer paints into, or null under `dom-svg`. */
function shapeCanvas(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas[data-shape-canvas]');
}

function repaintSteps(
  scene: CanvasSceneLike,
  steps = 60,
  warmup = 10,
): RepaintStats {
  const canvas = shapeCanvas();
  const total: number[] = [];
  const collect: number[] = [];
  const sortT: number[] = [];
  const condition: number[] = [];
  const fill: number[] = [];
  const drawn: number[] = [];
  const blitsBefore = Number(canvas?.dataset.canvas2dBlits ?? 0);

  for (let i = 0; i < steps + warmup; i++) {
    resetPaintCounters();
    const t0 = performance.now();
    scene.uiEpoch.update((n) => n + 1);
    const dt = performance.now() - t0;
    if (i < warmup) continue;
    total.push(dt);
    collect.push(paintCounters.collectMs);
    sortT.push(paintCounters.sortMs);
    condition.push(paintCounters.conditionMs);
    fill.push(paintCounters.drawMs - paintCounters.conditionMs);
    drawn.push(Number(canvas?.dataset.canvas2dDrawn ?? 0));
  }

  return {
    totalMed: median(total),
    totalP95: quantile(total, 0.95),
    collectMed: median(collect),
    sortMed: median(sortT),
    conditionMed: median(condition),
    fillMed: median(fill),
    drawnMed: median(drawn),
    blits: Number(canvas?.dataset.canvas2dBlits ?? 0) - blitsBefore,
  };
}

const REPAINT_COLUMNS: Column[] = [
  { head: 'total', width: 8 },
  { head: 'p95', width: 8 },
  { head: 'rep±', width: 6 },
  { head: 'collect', width: 8 },
  { head: 'sort', width: 7 },
  { head: 'cond', width: 7 },
  { head: 'fill', width: 7 },
  { head: 'drawn', width: 7 },
  { head: 'blits', width: 6 },
];

const REPAINT_HEAD = headerLine('run', LABEL_WIDTH, REPAINT_COLUMNS);

function repaintRow(label: string, reps: readonly RepaintStats[]): string {
  const s = medianFields(reps);
  const repSpread = spread(reps.map((r) => r.totalMed));
  return dataLine(label, LABEL_WIDTH, REPAINT_COLUMNS, [
    s.totalMed.toFixed(2),
    s.totalP95.toFixed(2),
    `${(100 * repSpread).toFixed(0)}%`,
    s.collectMed.toFixed(2),
    s.sortMed.toFixed(2),
    s.conditionMed.toFixed(2),
    s.fillMed.toFixed(2),
    s.drawnMed.toFixed(0),
    s.blits.toFixed(0),
  ]);
}

/**
 * What one full repaint costs, swept over shape count.
 *
 * Needs `?renderer=canvas-2d`; under `dom-svg` nothing reads `uiEpoch` and
 * every column would read 0, which is a missing renderer and not a fast one,
 * so that case says so and stops.
 */
export async function runRepaintBench(
  counts: number[] = [1000, 5000, 20000, 50000],
  reps = REPS,
): Promise<string> {
  const restoreCull = instrumentCull();
  const lines: string[] = [];
  try {
    lines.push('FULL REPAINT — median ms per repaint, camera still');
    // No `machineLine`, same as the static sweep: it wants a refresh rate,
    // `measureRefreshMs` spends 40 rAF ticks getting one, and no column here
    // looks at a frame boundary. In a throttled tab those ticks are also most
    // of the run's wall time, and the answer describes the pane's rAF rather
    // than the display.
    lines.push(`${navigator.userAgent}`);
    lines.push(`reps ${reps}  ${new Date().toISOString()}`);
    if (!shapeCanvas()) {
      lines.push('');
      lines.push(
        'no [data-shape-canvas]: this table needs ?renderer=canvas-2d — ' +
          'under dom-svg a uiEpoch bump paints nothing and every column ' +
          'would read 0.',
      );
      return lines.join('\n');
    }
    lines.push('');
    lines.push(REPAINT_HEAD);

    const notes = new Map<number, string>();
    const sweep = await repeatInterleaved(counts, reps, async (n) => {
      clear();
      await settle(200);
      seed(n);
      await settle(600);
      useCameraStore.getState().setCamera(HOME);
      await settle(400);
      const scene = theScene();
      if (!scene) throw new Error('no scene published');
      if (!notes.has(n)) {
        const dom = domStats();
        notes.set(
          n,
          `-- ${n}: ${dom.shapeNodes} containers, ${lastHits} in cull, ` +
            `heap ${dom.heapMb.toFixed(0)}MB`,
        );
      }
      return repaintSteps(scene);
    });

    for (const n of counts) {
      lines.push(notes.get(n) ?? '');
      lines.push(repaintRow(`${n} repaint`, sweep.get(n)!));
    }

    const warnings = auditRun(
      counts.map((n) => ({
        label: `${n} repaint`,
        repMedians: sweep.get(n)!.map((s) => s.totalMed),
      })),
      [],
    );
    const strayBlits = counts.filter((n) =>
      sweep.get(n)!.some((s) => s.blits !== 0),
    );
    if (strayBlits.length) {
      warnings.push(
        `[INVALID] ${strayBlits.join(', ')} reprojected mid-run — those rows ` +
          'priced a shift or a rescale, not a full repaint',
      );
    }
    if (warnings.length) {
      lines.push('');
      lines.push(...warnings);
    }
  } finally {
    restoreCull();
  }
  const text = lines.join('\n');
  (globalThis as unknown as { __repaint?: string }).__repaint = text;
  return text;
}

// ---------------------------------------------------------------------------
// Sampled profile
// ---------------------------------------------------------------------------
//
// Elimination can say WHICH subsystem a cost lives in; only a sampler can say
// which function. Chrome's JS Self-Profiling API gives one without DevTools,
// which matters here because the run has to be driven from a script anyway.
// Needs `Document-Policy: js-profiling` (set on the dev server).

interface SelfProfile {
  frames: { name: string; resourceId?: number; line?: number }[];
  stacks: { frameId: number; parentId?: number }[];
  samples: { stackId?: number; timestamp: number }[];
  resources: string[];
}

/** Fold the sample tree into self-time per `file:function`, hottest first. */
function foldProfile(profile: SelfProfile, top = 20): string[] {
  const self = new Map<string, number>();
  let counted = 0;
  for (const sample of profile.samples) {
    if (sample.stackId === undefined) continue;
    const stack = profile.stacks[sample.stackId];
    if (!stack) continue;
    const frame = profile.frames[stack.frameId];
    if (!frame) continue;
    const file = frame.resourceId ? profile.resources[frame.resourceId] : '';
    const short = (file ?? '').split('/').slice(-1)[0]?.split('?')[0] ?? '';
    const key = `${frame.name || '(anonymous)'}${short ? `  @${short}` : ''}${
      frame.line ? `:${frame.line}` : ''
    }`;
    self.set(key, (self.get(key) ?? 0) + 1);
    counted++;
  }
  // Samples that landed in no JS stack at all: the browser was busy with
  // something that is not our code — style, layout, paint, GC.
  const idle = profile.samples.length - counted;
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, top);
  return [
    `samples ${profile.samples.length}, in JS ${counted}, outside JS ${idle} ` +
      `(${((100 * idle) / Math.max(1, profile.samples.length)).toFixed(0)}% — style/layout/paint/GC)`,
    ...rows.map(
      ([key, n]) =>
        `${String(((100 * n) / Math.max(1, profile.samples.length)).toFixed(1)).padStart(5)}%  ${key}`,
    ),
  ];
}

/**
 * Seed `count`, then profile `steps` camera steps and fold the result.
 *
 * `mode` matters for the canvas renderers. A pan shifts pixels it already has;
 * a zoom cannot, so zoom is the only mode that puts the rasterizer on the
 * clock. Which frame the samples land in is the whole question: self time in
 * the fill call is Skia rasterizing, and a GPU pipeline would address it; self
 * time spread across the collect/sort/per-shape loop is draw-call overhead,
 * which it would not.
 */
export async function runProfile(
  count = 50000,
  steps = 40,
  mode: 'pan' | 'zoom' = 'pan',
): Promise<string[]> {
  const Profiler = (
    globalThis as unknown as {
      Profiler?: new (o: { sampleInterval: number; maxBufferSize: number }) => {
        stop: () => Promise<SelfProfile>;
      };
    }
  ).Profiler;
  if (!Profiler)
    return ['Profiler unavailable — is Document-Policy: js-profiling set?'];

  // Deliberately NOT instrumented: the cull wrapper would appear in the
  // sample tree as our own frames and inflate whatever it wraps.
  clear();
  await settle(200);
  const seedMs = seed(count);
  await settle(800);
  const store = useCameraStore.getState();
  store.setCamera(HOME);
  await settle(400);
  const dom = domStats();

  // Alternate direction every 40 steps, so a zoom oscillates around the start
  // instead of drifting: a drifting ramp ends at a different zoom, and then the
  // profile is describing a different scene from the one it started on.
  const anchor = { x: innerWidth / 2, y: innerHeight / 2 };
  let k = 0;
  const step = () => {
    if (mode === 'pan') return store.panByScreen(7, 5);
    const dir = Math.floor(k++ / 40) % 2 === 0 ? 1 / 1.04 : 1.04;
    store.zoomAtScreen(anchor, useCameraStore.getState().camera.z * dir);
  };

  // Warm up outside the profile, so JIT compilation is not what gets sampled.
  for (let i = 0; i < 10; i++) step();
  k = 0;
  store.setCamera(HOME);
  await settle(200);

  const profiler = new Profiler({ sampleInterval: 1, maxBufferSize: 500000 });
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) step();
  const wall = performance.now() - t0;
  const profile = await profiler.stop();

  return [
    `PROFILE — ${count} shapes, ${steps} ${mode} steps, ${wall.toFixed(0)}ms wall ` +
      `(${(wall / steps).toFixed(2)}ms/step), seed ${seedMs.toFixed(0)}ms`,
    `${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ${dom.total} DOM nodes, heap ${dom.heapMb.toFixed(0)}MB`,
    ...foldProfile(profile),
  ];
}

// ---------------------------------------------------------------------------
// Hook-count A/B
// ---------------------------------------------------------------------------
//
// The profile puts the per-step cost in React's useSyncExternalStore snapshot
// check, zustand's listener walk, and the LOD selectors themselves. If that is
// right the cost is proportional to the number of LOD hooks MOUNTED, not to
// shapes, pixels or geometry — so a shape type that subscribes once should
// cost a third of one that subscribes three times, at identical shape counts.
//
//   draw       useDotLength + useLodDash + useForceSolidInk   = 3
//   rectangle  useLodDash                                     = 1
//
// (Historical: draw now holds one subscription, `useInkLod`, so the two
// conditions are equal and this A/B no longer separates them.)
//
// A ~3x gap confirms the mechanism. Anything else refutes it. The claim is a
// ratio between two conditions that each need their own seeding pass, so the
// two alternate across repeats rather than running one after the other: a
// machine that slows down between them would otherwise show up as the ratio.

function seedRects(n: number, spacing = GRID_SPACING): number {
  const side = Math.ceil(Math.sqrt(n));
  const half = (side * spacing) / 2;
  let index = generateKeyBetween(null, null);
  const shapes: Shape[] = [];
  for (let i = 0; i < n; i++) {
    shapes.push({
      id: genId(),
      type: 'rectangle',
      x: (i % side) * spacing - half,
      y: Math.floor(i / side) * spacing - half,
      rotation: 0,
      opacity: 1,
      index,
      props: {
        w: 40,
        h: 30,
        color: '#1c1917',
        size: 2,
        dash: 'solid',
        fillStyle: 'none',
      },
    } as Shape);
    index = generateKeyBetween(index, null);
  }
  const t0 = performance.now();
  editor.transact(() => {
    for (const s of shapes) editor.createShape(s);
  });
  return performance.now() - t0;
}

export async function runHookAb(count = 50000, reps = REPS): Promise<string[]> {
  const restoreCull = instrumentCull();
  try {
    const conditions = [
      ['draw      (3 LOD hooks)', 3, seed],
      ['rectangle (1 LOD hook)', 1, seedRects],
    ] as const;
    const samples = new Map<string, { ms: number[]; note: string }>();
    for (let rep = 0; rep < reps; rep++) {
      for (const [label, , plant] of conditions) {
        clear();
        await settle(400);
        plant(count);
        await settle(900);
        useCameraStore.getState().setCamera(HOME);
        await settle(400);
        const r = staticSteps();
        const dom = domStats();
        const entry = samples.get(label) ?? {
          ms: [],
          note: `${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
        };
        entry.ms.push(r.jsMed);
        samples.set(label, entry);
      }
    }
    const lines = [
      `HOOK-COUNT A/B at ${count} shapes — median ms per pan step, ${reps} reps`,
    ];
    for (const [label, hooks] of conditions) {
      const entry = samples.get(label)!;
      const ms = median(entry.ms);
      lines.push(
        `${label}  ${ms.toFixed(2).padStart(6)}  ` +
          `(${(ms / hooks).toFixed(2)} per hook, rep± ${(100 * spread(entry.ms)).toFixed(0)}%)  ` +
          entry.note,
      );
    }
    const [a, b] = conditions;
    const ratio =
      median(samples.get(b[0])!.ms) > 0
        ? median(samples.get(a[0])!.ms) / median(samples.get(b[0])!.ms)
        : 0;
    lines.push(`ratio draw/rectangle ${ratio.toFixed(2)}x  (3.00x confirms)`);
    return lines;
  } finally {
    restoreCull();
  }
}

// ---------------------------------------------------------------------------
// Pan vs zoom, before and after the LOD decoupling
// ---------------------------------------------------------------------------
//
// Pan cannot change any LOD answer, so after the fix it should publish nothing
// and cost nothing at any shape count. Zoom genuinely can change one, so it
// still notifies — the fix does not claim to remove that, and measuring the two
// separately is the only way to say so honestly.
//
// `noopSet` is the control: a `setState({})` on the camera store that changes
// nothing. Before the fix it cost the same as a real pan, because the cost was
// the broadcast rather than the camera.

export async function runPanZoom(
  counts: number[] = [1000, 10000, 50000],
): Promise<string[]> {
  const restoreCull = instrumentCull();
  try {
    const store = useCameraStore.getState();
    const anchor = { x: 700, y: 450 };
    const lines = [
      'PAN vs ZOOM — median ms per step',
      'shapes'.padEnd(10) + '     pan      zoom   noopSet   containers',
    ];
    for (const n of counts) {
      clear();
      await settle(300);
      seed(n);
      await settle(900);
      store.setCamera(HOME);
      await settle(400);

      const pan = medianOf(60, () => store.panByScreen(7, 5));
      // Alternate direction every step, so zoom oscillates tightly around the
      // start instead of drifting. A drifting ramp ends each run at a different
      // zoom, which changes how much the cull region covers and how many shapes
      // are on screen — and then the column is comparing zoom levels, not shape
      // counts. (It read 33.8ms at 10k against 18.4ms at 50k before this.)
      let k = 0;
      const zoom = medianOf(60, () => {
        const dir = k++ % 2 === 0 ? 1.04 : 1 / 1.04;
        store.zoomAtScreen(anchor, useCameraStore.getState().camera.z * dir);
      });
      store.setCamera(HOME);
      const noop = medianOf(60, () => useCameraStore.setState({}));
      const dom = domStats();
      lines.push(
        String(n).padEnd(10) +
          pan.toFixed(2).padStart(8) +
          zoom.toFixed(2).padStart(10) +
          noop.toFixed(2).padStart(10) +
          String(dom.shapeNodes).padStart(13),
      );
    }
    return lines;
  } finally {
    restoreCull();
  }
}
