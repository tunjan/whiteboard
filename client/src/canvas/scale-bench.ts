// TEMPORARY perf harness — not part of the app. Delete with
// client/scale-bench.html and client/src/scale-bench.tsx.
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
//           `frame - js`.
// A sweep where `js` stays flat while `frame` climbs with shape count is a
// rendering cost, and no amount of Rust touches it.
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

import { useBenchFlags } from './bench-flags';
import { applyLowGraphics } from './use-canvas-ui-store';

const FRAMES = 120;
const WARMUP = 20;

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
let cullCalls = 0;
let lastHits = 0;
function instrumentCull(): void {
  const index = spatialIndex as unknown as {
    search: (b: unknown) => string[];
    __patched?: boolean;
  };
  if (index.__patched) return;
  const original = index.search.bind(spatialIndex);
  index.search = (bounds: unknown) => {
    const t0 = performance.now();
    const hits = original(bounds as never);
    cullMs += performance.now() - t0;
    cullCalls++;
    lastHits = hits.length;
    return hits;
  };
  index.__patched = true;
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
  hits: number;
}

function ramp(mode: 'pan' | 'zoom'): Promise<RunResult> {
  return new Promise((resolve) => {
    const frames: number[] = [];
    const js: number[] = [];
    const cull: number[] = [];
    const store = useCameraStore.getState();
    const anchor = { x: innerWidth / 2, y: innerHeight / 2 };
    let i = 0;
    let last = performance.now();
    const step = (now: number) => {
      frames.push(now - last);
      last = now;
      cullMs = 0;
      const t0 = performance.now();
      if (mode === 'zoom') {
        const dir = Math.floor(i / 40) % 2 === 0 ? 1 / 1.04 : 1.04;
        store.zoomAtScreen(anchor, useCameraStore.getState().camera.z * dir);
      } else {
        store.panByScreen(7, 5);
      }
      js.push(performance.now() - t0);
      cull.push(cullMs);
      i++;
      if (i < FRAMES + WARMUP) requestAnimationFrame(step);
      else
        resolve({
          frames: frames.slice(WARMUP),
          js: js.slice(WARMUP),
          cull: cull.slice(WARMUP),
          hits: lastHits,
        });
    };
    requestAnimationFrame(step);
  });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : 0);
function q(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
}
const pad = (v: string | number, n: number) => String(v).padStart(n);

function row(label: string, r: RunResult): string {
  const fps = 1000 / mean(r.frames);
  const jsMed = q(r.js, 0.5);
  const frameMed = q(r.frames, 0.5);
  return [
    label.padEnd(20),
    pad(fps.toFixed(0), 4),
    pad(frameMed.toFixed(1), 7),
    pad(q(r.frames, 0.95).toFixed(1), 7),
    pad(jsMed.toFixed(2), 7),
    pad(q(r.js, 0.95).toFixed(2), 7),
    // What the browser did after our JS returned. The headline number.
    pad(Math.max(0, frameMed - jsMed).toFixed(1), 8),
    pad(q(r.cull, 0.5).toFixed(3), 7),
    pad(r.hits, 6),
  ].join(' ');
}

const HEAD = [
  'run'.padEnd(20),
  ' fps',
  '  frame',
  '    p95',
  '     js',
  '  jsp95',
  ' browser',
  '   cull',
  '  vis',
].join(' ');

// ---------------------------------------------------------------------------
// DOM-free microbenchmark — the ceiling on any language port
// ---------------------------------------------------------------------------

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
  for (let i = 0; i < 200; i++) index.search(region);
  const ITER = 2000;
  const tSearch = performance.now();
  let hits = 0;
  for (let i = 0; i < ITER; i++) hits = index.search(region).length;
  const searchUs = ((performance.now() - tSearch) / ITER) * 1000;

  const tRegion = performance.now();
  for (let i = 0; i < 100000; i++)
    quantizedCullRegion({ x: i, y: i, z: 1 + (i % 7) / 10 }, 1400, 900);
  const regionUs = ((performance.now() - tRegion) / 100000) * 1000;

  // The set construction the scene does with the search result each frame.
  const ids = index.search(region);
  const tSet = performance.now();
  for (let i = 0; i < ITER; i++) new Set(ids);
  const setUs = ((performance.now() - tSet) / ITER) * 1000;

  // Stroke outline generation — the "curve fitting / simplification" work.
  const points = strokePoints(rnd);
  const dynamics = {
    simulatePressure: true,
    thinning: 0.5,
    smoothing: 0.5,
    streamline: 0.5,
  };
  for (let i = 0; i < 200; i++) getInkPathData(points, 4, true, dynamics);
  const tInk = performance.now();
  for (let i = 0; i < ITER; i++) getInkPathData(points, 4, true, dynamics);
  const inkUs = ((performance.now() - tInk) / ITER) * 1000;

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
// Gating
// ---------------------------------------------------------------------------

const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Block until the page has been idle for `need` consecutive cheap frames, so
 *  seeding work never lands inside the next measurement. */
function waitForIdle(need = 45, timeoutMs = 120000): Promise<boolean> {
  return new Promise((resolve) => {
    const deadline = performance.now() + timeoutMs;
    let run = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      run = dt < 20 ? run + 1 : 0;
      if (run >= need) resolve(true);
      else if (now > deadline) resolve(false);
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

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

// ---------------------------------------------------------------------------
// The sweep
// ---------------------------------------------------------------------------

const HOME = { x: -700, y: -450, z: 1 };

export async function runScaleBench(
  counts: number[] = [1000, 5000, 20000, 50000],
): Promise<string> {
  await whenVisible();
  instrumentCull();

  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;left:8px;top:8px;z-index:99999;background:#000;color:#0f0;' +
    'padding:10px 14px;font:11px/1.5 ui-monospace,monospace;white-space:pre;' +
    'pointer-events:none;max-width:98vw;max-height:96vh;overflow:hidden';
  document.body.append(box);

  const ua = navigator.userAgent;
  const engine = ua.includes('Firefox')
    ? 'Firefox'
    : ua.includes('Chrome')
      ? 'Chromium'
      : 'WebKit';
  const lines: string[] = [
    `${engine}  dpr ${devicePixelRatio}  viewport ${innerWidth}x${innerHeight}  ${new Date().toISOString()}`,
    '',
  ];
  const show = (extra = '') => {
    box.textContent = [...lines, extra].join('\n');
  };
  show('starting…');

  // --- Part 1: the scaling sweep ------------------------------------------
  lines.push('SCALING SWEEP — same camera, same density, only the total grows');
  lines.push(HEAD);
  show();

  for (const n of counts) {
    clear();
    await settle(200);
    show(`seeding ${n}…`);
    const seedMs = seed(n);
    useCameraStore.getState().setCamera(HOME);
    show(`seeded ${n} in ${seedMs.toFixed(0)}ms — waiting for idle…`);
    const quiet = await waitForIdle();
    const dom = domStats();
    lines.push(
      `-- ${n} shapes: seed ${seedMs.toFixed(0)}ms, ` +
        `${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ` +
        `${dom.total} DOM nodes, heap ${dom.heapMb.toFixed(0)}MB` +
        (quiet ? '' : '  [NEVER IDLE — SUSPECT]'),
    );
    show();
    for (const mode of ['pan', 'zoom'] as const) {
      useCameraStore.getState().setCamera(HOME);
      await settle(300);
      await waitForIdle(20, 8000);
      show(`running ${n} ${mode}…`);
      lines.push(row(`${n} ${mode}`, await ramp(mode)));
      show();
    }
  }

  // --- Part 2: subsystem A/B at the top count -----------------------------
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
    { name: '-chrome blur', low: true },
    { name: '-shapes', flags: { noShapes: true } },
    // Repeat of line one. If these two disagree the machine drifted and the
    // whole table is noise.
    { name: 'baseline#2' },
  ];
  for (const config of configs) {
    useBenchFlags.setState({
      noBg: false,
      noShapes: false,
      ...config.flags,
    });
    applyLowGraphics(!!config.low);
    useCameraStore.getState().setCamera(HOME);
    await settle(400);
    await waitForIdle(20, 8000);
    show(`running ${config.name}…`);
    lines.push(row(config.name, await ramp('pan')));
    show();
  }
  useBenchFlags.setState({
    noBg: false,
    noShapes: false,
  });
  applyLowGraphics(false);

  // --- Part 3: density A/B, total held at the top count --------------------
  lines.push('');
  lines.push(
    `DENSITY A/B — ${top} shapes either way, only how many are ON SCREEN changes`,
  );
  lines.push(HEAD);
  show();
  for (const [label, spacing] of [
    ['spread 4x', GRID_SPACING * 4],
    ['dense 1x', GRID_SPACING],
  ] as const) {
    clear();
    await settle(200);
    show(`re-seeding ${label}…`);
    seed(top, spacing);
    useCameraStore.getState().setCamera(HOME);
    await waitForIdle();
    const dom = domStats();
    lines.push(
      `-- ${label}: ${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
    );
    lines.push(row(label, await ramp('pan')));
    show();
  }

  // --- Part 4: the microbenchmark ------------------------------------------
  lines.push('');
  lines.push(...microbench(top));
  show();

  const text = lines.join('\n');
  (globalThis as unknown as { __scaleBench?: string }).__scaleBench = text;
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

interface StaticResult {
  js: number[];
  layout: number[];
  cull: number[];
  hits: number;
}

function staticSteps(steps = 120): StaticResult {
  const store = useCameraStore.getState();
  const js: number[] = [];
  const layout: number[] = [];
  const cull: number[] = [];
  const probe = document.querySelector('[data-shape-layer]') ?? document.body;
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
    }
  }
  return { js, layout, cull, hits: lastHits };
}

function staticRow(label: string, r: StaticResult): string {
  return [
    label.padEnd(20),
    pad(q(r.js, 0.5).toFixed(2), 7),
    pad(q(r.js, 0.95).toFixed(2), 7),
    pad(q(r.layout, 0.5).toFixed(2), 8),
    pad(q(r.layout, 0.95).toFixed(2), 8),
    pad(q(r.cull, 0.5).toFixed(3), 7),
    pad(r.hits, 6),
  ].join(' ');
}

const STATIC_HEAD = [
  'run'.padEnd(20),
  '     js',
  '  jsp95',
  '  layout',
  ' lay.p95',
  '   cull',
  '  vis',
].join(' ');

/**
 * The sweep, without any dependency on the tab being presented.
 *
 * Async only to let React commit. Seeding publishes a new id list, and React
 * schedules that work on a macrotask; reading the DOM in the same tick would
 * count the nodes of the PREVIOUS run.
 */
export async function runStaticBench(
  counts: number[] = [1000, 5000, 20000, 50000],
): Promise<string> {
  instrumentCull();
  const ua = navigator.userAgent;
  const engine = ua.includes('Firefox')
    ? 'Firefox'
    : ua.includes('Chrome')
      ? 'Chromium'
      : 'WebKit';
  const lines: string[] = [
    `${engine}  dpr ${devicePixelRatio}  ${new Date().toISOString()}`,
    'STATIC SWEEP — no rAF. js = our code; layout = forced style+layout.',
    'Paint and composite are NOT included, so `layout` understates the browser.',
    '',
    STATIC_HEAD,
  ];
  for (const n of counts) {
    clear();
    await settle(150);
    const seedMs = seed(n);
    await settle(400);
    useCameraStore.getState().setCamera(HOME);
    void document.body.offsetHeight;
    await settle(150);
    const dom = domStats();
    lines.push(
      `-- ${n} shapes: seed ${seedMs.toFixed(0)}ms, ` +
        `${dom.shapeNodes} containers, ${dom.visibleNodes} shown, ` +
        `${dom.total} DOM nodes, ${dom.cameraSubs} camera subs, ` +
        `heap ${dom.heapMb.toFixed(0)}MB`,
    );
    lines.push(staticRow(`${n} pan`, staticSteps()));
  }

  // Density A/B: the total is held constant, only how many shapes are on
  // screen changes. If the numbers barely move, the cost is being paid by
  // shapes that are mounted and hidden, not by shapes being drawn.
  const top = counts[counts.length - 1]!;
  lines.push('');
  lines.push(`DENSITY A/B — ${top} shapes either way`);
  lines.push(STATIC_HEAD);
  for (const [label, spacing] of [
    ['spread 4x', GRID_SPACING * 4],
    ['dense 1x', GRID_SPACING],
  ] as const) {
    clear();
    await settle(150);
    seed(top, spacing);
    await settle(400);
    useCameraStore.getState().setCamera(HOME);
    void document.body.offsetHeight;
    await settle(150);
    const dom = domStats();
    lines.push(
      `-- ${label}: ${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
    );
    lines.push(staticRow(label, staticSteps()));
  }

  lines.push('');
  lines.push(...microbench(top));
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
  return q(samples, 0.5);
}

export async function runAttribution(count = 50000): Promise<string> {
  instrumentCull();
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

/** Seed `count`, then profile `steps` pan steps and fold the result. */
export async function runProfile(
  count = 50000,
  steps = 40,
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

  instrumentCull();
  clear();
  await settle(200);
  const seedMs = seed(count);
  await settle(800);
  const store = useCameraStore.getState();
  store.setCamera(HOME);
  await settle(400);
  const dom = domStats();

  // Warm up outside the profile, so JIT compilation is not what gets sampled.
  for (let i = 0; i < 10; i++) store.panByScreen(7, 5);

  const profiler = new Profiler({ sampleInterval: 1, maxBufferSize: 500000 });
  const t0 = performance.now();
  for (let i = 0; i < steps; i++) store.panByScreen(7, 5);
  const wall = performance.now() - t0;
  const profile = await profiler.stop();

  return [
    `PROFILE — ${count} shapes, ${steps} pan steps, ${wall.toFixed(0)}ms wall ` +
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
// A ~3x gap confirms the mechanism. Anything else refutes it.

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

export async function runHookAb(count = 50000): Promise<string[]> {
  instrumentCull();
  const lines = [`HOOK-COUNT A/B at ${count} shapes — median ms per pan step`];
  for (const [label, hooks, plant] of [
    ['draw      (3 LOD hooks)', 3, seed],
    ['rectangle (1 LOD hook)', 1, seedRects],
  ] as const) {
    clear();
    await settle(400);
    plant(count);
    await settle(900);
    useCameraStore.getState().setCamera(HOME);
    await settle(400);
    const r = staticSteps();
    const dom = domStats();
    const ms = q(r.js, 0.5);
    lines.push(
      `${label}  ${ms.toFixed(2).padStart(6)}  ` +
        `(${(ms / hooks).toFixed(2)} per hook)  ` +
        `${dom.shapeNodes} containers, ${dom.visibleNodes} shown`,
    );
  }
  return lines;
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
  instrumentCull();
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
        pad(pan.toFixed(2), 8) +
        pad(zoom.toFixed(2), 10) +
        pad(noop.toFixed(2), 10) +
        pad(dom.shapeNodes, 13),
    );
  }
  return lines;
}
