// TEMPORARY perf harness — not part of the app. Delete with ./bench-flags.ts
// and the `TEMPORARY` markers in Canvas.tsx / camera-snapshot.ts.
//
// Enable with `?zoombench=1200` on a board URL. Seeds N synthetic ink strokes,
// then drives a scripted camera ramp through the camera store — the same store
// the trackpad drives — under a matrix of A/B configurations, and reports the
// frame-time distribution of each.
//
// The matrix is the measurement. Frame timings alone say a zoom is slow; they
// cannot say which of the shape layer, the grid, the snapshot bitmap or the
// frosted chrome is costing the frame. Switching one subsystem off at a time
// and re-running the identical ramp does, and it does it without a profiler,
// which matters because the engine in question is the one whose profiler is
// least comparable to the other's.
import { genId, type Shape } from '@whiteboard/shared';
import {
  benchCounters,
  resetBenchCounters,
  useBenchFlags,
} from './bench-flags';
import { applyLowGraphics } from './use-canvas-ui-store';
import { editor } from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { generateKeyBetween } from './order';

/** Frames per scripted run, past the discarded warm-up. */
const FRAMES = 160;
const WARMUP = 20;

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
  caps: number[];
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
          caps: benchCounters.caps.slice(),
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

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

function quantile(sorted: number[], q: number): number {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0
  );
}

function line(label: string, r: RunResult): string {
  const f = [...r.frames].sort((a, b) => a - b);
  const j = [...r.js].sort((a, b) => a - b);
  const fps = 1000 / (sum(r.frames) / r.frames.length);
  const slow = f.filter((v) => v > 20).length;
  return [
    label.padEnd(22),
    `fps ${fps.toFixed(0).padStart(3)}`,
    `med ${quantile(f, 0.5).toFixed(1).padStart(5)}`,
    `p95 ${quantile(f, 0.95).toFixed(1).padStart(5)}`,
    `max ${(f[f.length - 1] ?? 0).toFixed(0).padStart(4)}`,
    `>20ms ${((100 * slow) / f.length).toFixed(0).padStart(3)}%`,
    `js ${quantile(j, 0.5).toFixed(1)}/${quantile(j, 0.95).toFixed(1)}`,
    `caps ${r.caps.length}@${(sum(r.caps) / Math.max(1, r.caps.length)).toFixed(1)}ms`,
    `cull ${r.cull.length}@${(sum(r.cull) / Math.max(1, r.cull.length)).toFixed(1)}`,
    `tree ${r.tree.length}@${(sum(r.tree) / Math.max(1, r.tree.length)).toFixed(1)}`,
  ].join('  ');
}

// ---------------------------------------------------------------------------
// The matrix
// ---------------------------------------------------------------------------

interface Config {
  name: string;
  noBg?: boolean;
  noShapes?: boolean;
  noSnapshot?: boolean;
  willChange?: boolean;
  freezeBg?: boolean;
  /** Turn off the chrome's masked `backdrop-filter`. */
  lowGraphics?: boolean;
  /** Which ramps to run under this config. */
  modes?: ('zoom' | 'pan')[];
}

// Ordered so each line differs from `baseline` in exactly one thing, except
// `bare`, which is the floor: what a frame costs when the board draws nothing.
const CONFIGS: Config[] = [
  { name: 'baseline', modes: ['zoom', 'pan'] },
  { name: '-chrome blur', lowGraphics: true },
  { name: '-background', noBg: true },
  { name: '-snapshot', noSnapshot: true },
  { name: '-shapes', noShapes: true, noSnapshot: true },
  { name: '+will-change', willChange: true },
  { name: 'frozen bg', freezeBg: true },
  { name: '-bg -snapshot', noBg: true, noSnapshot: true },
  {
    name: 'bare',
    noBg: true,
    noShapes: true,
    noSnapshot: true,
    lowGraphics: true,
  },
  // Repeat of the first line. The matrix is only readable if these two agree:
  // a gap between them is drift in the machine, not a difference between
  // configs, and the whole run has to be thrown away.
  { name: 'baseline#2' },
];

function apply(c: Config): void {
  useBenchFlags.setState({
    noBg: !!c.noBg,
    noShapes: !!c.noShapes,
    noSnapshot: !!c.noSnapshot,
    willChange: !!c.willChange,
    freezeBg: !!c.freezeBg,
  });
  applyLowGraphics(!!c.lowGraphics);
}

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Block until the page has been idle for `need` consecutive cheap frames.
 *
 * Seeding writes thousands of shapes through Yjs and into IndexedDB, and that
 * work carries on well after the shapes are on screen. Without this gate the
 * first configs in the matrix were measured against a busy machine and the last
 * ones against a quiet one, which reads exactly like a config difference and is
 * not one. A fixed sleep cannot do the job — how long the writes take depends
 * on the shape count and on whether the profile is warm.
 */
function waitForIdle(need = 60, timeoutMs = 30000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let run = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      run = dt < 18 ? run + 1 : 0;
      if (run >= need) resolve(true);
      else if (now > deadline) resolve(false);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Resolve once the tab is actually on screen.
 *
 * A background tab gets a throttled `requestAnimationFrame`, so a run started
 * in one never finishes — it sits there spinning the ramp at a frame a second,
 * burning a core and poisoning whatever is being measured in the foreground.
 * Waiting is also the only honest thing to do: frame timings from a tab the
 * compositor isn't presenting are not measurements of anything.
 */
function whenVisible(): Promise<void> {
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

/** Seed only, and expose the camera store, for driving a board by hand. */
export function seedOnly(count: number): void {
  seedStrokes(count);
  (globalThis as unknown as { __cam?: unknown }).__cam = useCameraStore;
}

export async function runZoomBench(count: number): Promise<void> {
  await whenVisible();
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;padding:8px 12px;font:11px/1.45 monospace;white-space:pre;pointer-events:none;max-width:96vw;overflow:hidden';
  box.textContent = 'seeding…';
  document.body.append(box);

  seedStrokes(count);
  box.textContent = 'seeded — waiting for the machine to go quiet…';
  const quiet = await waitForIdle();

  const ua = navigator.userAgent;
  const engine = ua.includes('Firefox')
    ? 'Firefox'
    : ua.includes('Chrome')
      ? 'Chromium'
      : 'other';
  const lines = [
    `${engine}  shapes ${count}  dpr ${devicePixelRatio}  ${innerWidth}x${innerHeight}${quiet ? '' : '  [NEVER WENT IDLE — SUSPECT]'}`,
    'config                  fps  med    p95    max  >20ms  js med/p95  captures  cull  tree',
  ];
  box.textContent = lines.join('\n');

  // Every run starts from the same camera, so configs compare like for like.
  const home = useCameraStore.getState().camera;

  for (const config of CONFIGS) {
    for (const mode of config.modes ?? ['zoom']) {
      useCameraStore.getState().setCamera(home);
      apply(config);
      // Let React commit the flag change and the camera settle out of
      // `isMoving` before the ramp starts.
      await settle(400);
      await waitForIdle(20, 4000);
      resetBenchCounters();
      box.textContent = [...lines, `running ${config.name} ${mode}…`].join(
        '\n',
      );
      const result = await run(mode);
      lines.push(line(`${config.name} ${mode}`, result));
      box.textContent = lines.join('\n');
    }
  }

  apply({ name: 'reset' });
  useCameraStore.getState().setCamera(home);

  const text = lines.join('\n');
  (globalThis as unknown as { __bench?: string }).__bench = text;
  void fetch('http://127.0.0.1:8777/result', {
    method: 'POST',
    body: JSON.stringify({ engine, text }),
  }).catch(() => {});
}
