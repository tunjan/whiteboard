// TEMPORARY perf harness — delete with client/src/canvas/scale-bench.ts.
//
// Mounts the real Canvas on a board with no persistence and no collab, so the
// only thing being timed is the render path. Add `?counts=1000,50000` to change
// the sweep; `?reps=1` to run each table once instead of three times (faster,
// and with no way to tell a real difference from a machine that drifted);
// `?auto=0` to seed nothing and drive the board by hand.
import { createRoot } from 'react-dom/client';
import './index.css';
import { Canvas } from './canvas/Canvas';
import { loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { useToolStore } from './canvas/use-tool-store';
import {
  runAttribution,
  runScaleBench,
  runStaticBench,
  runSubsystemAb,
  runRasterSweep,
  runProfile,
  runHookAb,
  runPanZoom,
  runRepaintBench,
} from './canvas/scale-bench';
import { useBenchFlags } from './canvas/bench-flags';
import { editor } from './canvas/use-document-store';

// A tab the compositor is not presenting never runs the "deliver resize loop",
// so ResizeObserver callbacks never fire, so the canvas measures 0x0 — and a
// 0x0 viewport turns culling OFF, which would make every number below describe
// a configuration the app never renders. Deliver one observation by hand on
// `observe()`; a presented tab gets the same thing from the real observer a
// frame later, so this changes nothing about what is being measured.
const NativeResizeObserver = globalThis.ResizeObserver;
class EagerResizeObserver extends NativeResizeObserver {
  constructor(private readonly cb: ResizeObserverCallback) {
    super(cb);
  }
  override observe(target: Element, options?: ResizeObserverOptions): void {
    super.observe(target, options);
    setTimeout(() => {
      const rect = target.getBoundingClientRect();
      if (!rect.width && !rect.height) return;
      this.cb(
        [{ target, contentRect: rect } as unknown as ResizeObserverEntry],
        this,
      );
    }, 0);
  }
}
globalThis.ResizeObserver = EagerResizeObserver as typeof ResizeObserver;

// Count live camera-store subscriptions. Every mounted shape that calls an LOD
// hook adds one, and each one is a listener the store must walk — and a
// snapshot React must re-check — on every camera change.
const cameraSubscribe = useCameraStore.subscribe.bind(useCameraStore);
let cameraSubscribers = 0;
(useCameraStore as unknown as { subscribe: typeof cameraSubscribe }).subscribe =
  ((...args: Parameters<typeof cameraSubscribe>) => {
    cameraSubscribers++;
    const stop = cameraSubscribe(...args);
    return () => {
      cameraSubscribers--;
      stop();
    };
  }) as typeof cameraSubscribe;
Object.defineProperty(globalThis, 'cameraSubscribers', {
  get: () => cameraSubscribers,
});

loadBoard('temporary-scale-bench', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: -700, y: -450, z: 1 }, activeKey: '' });
useToolStore.getState().setTool('hand');

createRoot(document.getElementById('root')!).render(<Canvas />);

Object.assign(globalThis, {
  runScaleBench,
  runStaticBench,
  runSubsystemAb,
  runRasterSweep,
  runAttribution,
  runProfile,
  runHookAb,
  runPanZoom,
  runRepaintBench,
  useCameraStore,
  useBenchFlags,
  editor,
});

const params = new URLSearchParams(location.search);
if (params.get('auto') !== '0') {
  const counts = (params.get('counts') ?? '1000,5000,20000,50000')
    .split(',')
    .map(Number)
    .filter((n) => n > 0);
  const reps = Math.max(1, Number(params.get('reps')) || 3);
  setTimeout(() => {
    void runScaleBench(counts, reps).then((text) => {
      (globalThis as unknown as { __done?: boolean }).__done = true;
      console.log(text);
    });
  }, 1200);
}
