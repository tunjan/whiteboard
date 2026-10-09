// TEMPORARY perf harness — not part of the app. Delete with ./bench-flags.ts,
// ./bench-stats.ts and the `TEMPORARY` markers in Canvas.tsx.
//
// Enable with `?zoombench=1200` on a board URL (`&zoomreps=5` to trade run
// time for resolution). Seeds N synthetic ink strokes, then drives a scripted
// camera ramp through the camera store — the same store the trackpad drives —
// under a matrix of A/B configurations, and reports the frame-time
// distribution of each.
//
// The matrix is the measurement. Frame timings alone say a zoom is slow; they
// cannot say which of the shape layer, the grid or the frosted chrome is
// costing the frame. Switching one subsystem off at a time
// and re-running the identical ramp does, and it does it without a profiler,
// which matters because the engine in question is the one whose profiler is
// least comparable to the other's.
//
// Every cell is run `REPS` times, rep-major rather than cell-major, and the
// table reports the median across repeats with the spread beside it. One run
// per config cannot distinguish a subsystem that costs 2ms from a machine that
// got 2ms slower while the matrix was running, and on a laptop under sustained
// load the second is the more likely of the two.
import { genId, type Shape } from '@whiteboard/shared';
import {
  benchCounters,
  resetBenchCounters,
  useBenchFlags,
} from './bench-flags';
import {
  auditRun,
  type Column,
  dataLine,
  engineName,
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
import { applyLowGraphics } from './use-canvas-ui-store';
import { editor } from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { generateKeyBetween } from './order';

/** Frames per scripted run, past the discarded warm-up. */
const FRAMES = 160;
const WARMUP = 20;
/** Repeats of the whole matrix. */
const REPS = 3;
/** A frame this far past the display's interval counts as dropped. */
const DROP_FACTOR = 1.5;

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

function seedStrokes(n: number): void {
  let seed = 987654321;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  let index = generateKeyBetween(null, null);
  const shapes: Shape[] = [];
  for (let i = 0; i < n; i++) {
    const points = [];
    let x = 0;
    let y = 0;
    let a = rnd() * 6.28;
    for (let p = 0; p < 30; p++) {
      a += (rnd() - 0.5) * 1.2;
      x += Math.cos(a) * 6;
      y += Math.sin(a) * 6;
      points.push({ x, y, pressure: 0.4 + 0.4 * rnd() });
    }
    shapes.push({
      id: genId(),
      type: 'draw',
      x: rnd() * 4000 - 1000,
      y: rnd() * 3000 - 800,
      rotation: 0,
      opacity: 1,
      index,
      props: {
        points,
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
  editor.transact(() => {
    for (const s of shapes) editor.createShape(s);
  });
}

// ---------------------------------------------------------------------------
// One scripted run
// ---------------------------------------------------------------------------

interface RunResult {
  /** Frame-to-frame intervals, warm-up already dropped. */
  frames: number[];
  /** Wall time spent inside the driver's own rAF callback, per frame. */
  js: number[];
  cull: number[];
  tree: number[];
}

/**
 * Drive the camera for `FRAMES` frames and record what each frame cost.
 *
 * Two clocks, deliberately. `frames` is rAF-to-rAF, which is what the user
 * feels and includes everything the browser does after our JS returns —
 * style, layout, paint, composite. `js` is the driver callback alone. A run
 * where `js` stays flat while `frames` blows out is a rendering cost, not a
 * scripting one, and that distinction is the first fork in this hunt.
 */
function run(mode: 'zoom' | 'pan'): Promise<RunResult> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    const js: number[] = [];
    const store = useCameraStore.getState();
    const anchor = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let i = 0;
    let last = performance.now();
    const step = (now: number) => {
      // The subsystem counters are drained here rather than before the run, so
      // the searches and tree rebuilds they hold cover exactly the frames the
      // `frames` and `js` arrays cover. Draining before the warm-up mixed 20
      // unmeasured frames of work into per-frame averages taken over 160.
      if (i === WARMUP) resetBenchCounters();
      frames.push(now - last);
      last = now;
      const t0 = performance.now();
      if (mode === 'zoom') {
        // ~4%/frame in and out, the rate a trackpad pinch produces. The ramp
        // spans the whole board: out to ~0.15x and back.
        const dir = Math.floor(i / 48) % 2 === 0 ? 1 / 1.04 : 1.04;
        store.zoomAtScreen(anchor, useCameraStore.getState().camera.z * dir);
      } else {
        store.panByScreen(6, 4);
      }
      js.push(performance.now() - t0);
      i++;
      if (i < FRAMES + WARMUP) requestAnimationFrame(step);
      else {
        resolve({
          frames: frames.slice(WARMUP),
          js: js.slice(WARMUP),
          cull: benchCounters.cull.slice(),
          tree: benchCounters.tree.slice(),
        });
      }
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Everything one run of one cell contributes to its row. */
interface RunStats {
  fps: number;
  frameMed: number;
  frameP95: number;
  frameMax: number;
  dropPct: number;
  jsMed: number;
  jsP95: number;
  /** Per-frame `frame - js`: what the browser did after our JS returned. */
  browserMed: number;
  cullCalls: number;
  cullMean: number;
  treeCalls: number;
  treeMean: number;
}

function statsOf(r: RunResult, dropMs: number): RunStats {
  return {
    fps: 1000 / mean(r.frames),
    frameMed: median(r.frames),
    frameP95: quantile(r.frames, 0.95),
    frameMax: r.frames.length ? Math.max(...r.frames) : 0,
    dropPct:
      (100 * r.frames.filter((v) => v > dropMs).length) /
      Math.max(1, r.frames.length),
    jsMed: median(r.js),
    jsP95: quantile(r.js, 0.95),
    browserMed: median(residuals(r.frames, r.js)),
    cullCalls: r.cull.length,
    cullMean: mean(r.cull),
    treeCalls: r.tree.length,
    treeMean: mean(r.tree),
  };
}

const LABEL_WIDTH = 22;

// One list, used for both the header and every row. `dataLine` throws if a row
// disagrees with it, which is the only reliable defence against a header that
// names a column nothing emits.
const COLUMNS: Column[] = [
  { head: 'fps', width: 4 },
  { head: 'frame', width: 6 },
  { head: 'p95', width: 6 },
  { head: 'max', width: 5 },
  { head: 'drop%', width: 5 },
  { head: 'js', width: 6 },
  { head: 'jsp95', width: 6 },
  { head: 'browser', width: 7 },
  { head: 'rep±', width: 5 },
  { head: 'cull', width: 11 },
  { head: 'tree', width: 11 },
];

function row(label: string, reps: readonly RunStats[]): string {
  const s = medianFields(reps);
  const repSpread = spread(reps.map((r) => r.frameMed));
  return dataLine(label, LABEL_WIDTH, COLUMNS, [
    s.fps.toFixed(0),
    s.frameMed.toFixed(1),
    s.frameP95.toFixed(1),
    s.frameMax.toFixed(0),
    s.dropPct.toFixed(0),
    s.jsMed.toFixed(1),
    s.jsP95.toFixed(1),
    s.browserMed.toFixed(1),
    `${(100 * repSpread).toFixed(0)}%`,
    `${s.cullCalls.toFixed(0)}@${s.cullMean.toFixed(1)}`,
    `${s.treeCalls.toFixed(0)}@${s.treeMean.toFixed(1)}`,
  ]);
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface Config {
  name: string;
  noBg?: boolean;
  noShapes?: boolean;
  /** Turn off the glass layer's ornament — its sheen and bevel planes. */
  lowGraphics?: boolean;
  /** Which ramps to run under this config. */
  modes?: ('zoom' | 'pan')[];
}

// Ordered so each line differs from `baseline` in exactly one thing, except
// `bare`, which is the floor: what a frame costs when the board draws nothing.
const CONFIGS: Config[] = [
  { name: 'baseline', modes: ['zoom', 'pan'] },
  { name: '-glass ornament', lowGraphics: true },
  { name: '-background', noBg: true },
  { name: '-shapes', noShapes: true },
  {
    name: 'bare',
    noBg: true,
    noShapes: true,
    lowGraphics: true,
  },
  // Repeat of the first line, run last within every repeat. `auditRun` checks
  // the two against each other and says so in the table when they disagree —
  // a gap between them is drift in the machine, not a difference between
  // configs, and the whole run has to be thrown away.
  { name: 'baseline#2' },
];

function apply(c: Config): void {
  useBenchFlags.setState({
    noBg: !!c.noBg,
    noShapes: !!c.noShapes,
  });
  applyLowGraphics(!!c.lowGraphics);
}

/** Seed only, and expose the camera store, for driving a board by hand. */
export function seedOnly(count: number): void {
  seedStrokes(count);
  (globalThis as unknown as { __cam?: unknown }).__cam = useCameraStore;
}

interface Cell {
  config: Config;
  mode: 'zoom' | 'pan';
  label: string;
}

export async function runZoomBench(count: number, reps = REPS): Promise<void> {
  await whenVisible();
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;padding:8px 12px;font:11px/1.45 monospace;white-space:pre;pointer-events:none;max-width:96vw;overflow:hidden';
  box.textContent = 'measuring the display…';
  document.body.append(box);

  // Before seeding, while the page is as quiet as it will ever be.
  const refreshMs = await measureRefreshMs();
  const dropMs = refreshMs * DROP_FACTOR;

  box.textContent = 'seeding…';
  seedStrokes(count);
  box.textContent = 'seeded — waiting for the machine to go quiet…';
  const quiet = await waitForIdle(refreshMs, { need: 60, timeoutMs: 30000 });

  const head = [
    machineLine(refreshMs),
    `shapes ${count}  reps ${reps}  ${FRAMES} frames/run  ` +
      `drop > ${dropMs.toFixed(1)}ms${quiet ? '' : '  [NEVER WENT IDLE — SUSPECT]'}`,
    '',
    headerLine('config', LABEL_WIDTH, COLUMNS),
  ];
  box.textContent = head.join('\n');

  // Every run starts from the same camera, so configs compare like for like.
  const home = useCameraStore.getState().camera;

  const cells: Cell[] = CONFIGS.flatMap((config) =>
    (config.modes ?? ['zoom']).map((mode) => ({
      config,
      mode,
      label: `${config.name} ${mode}`,
    })),
  );

  const results = await repeatInterleaved(cells, reps, async (cell, rep) => {
    useCameraStore.getState().setCamera(home);
    apply(cell.config);
    // Let React commit the flag change and the camera settle out of
    // `isMoving` before the ramp starts.
    await settle(400);
    await waitForIdle(refreshMs, { need: 20, timeoutMs: 4000 });
    box.textContent = [
      ...head,
      `rep ${rep + 1}/${reps} — running ${cell.label}…`,
    ].join('\n');
    return statsOf(await run(cell.mode), dropMs);
  });

  apply({ name: 'reset' });
  useCameraStore.getState().setCamera(home);

  const rows = cells.map((cell) => row(cell.label, results.get(cell)!));
  const warnings = auditRun(
    cells.map((cell) => ({
      label: cell.label,
      repMedians: results.get(cell)!.map((s) => s.frameMed),
    })),
    [['baseline zoom', 'baseline#2 zoom']],
  );

  const text = [
    ...head,
    ...rows,
    ...(warnings.length ? ['', ...warnings] : []),
  ].join('\n');
  box.textContent = text;
  (globalThis as unknown as { __bench?: string }).__bench = text;
  void fetch('http://127.0.0.1:8777/result', {
    method: 'POST',
    body: JSON.stringify({ engine: engineName(), text }),
  }).catch(() => {});
}
