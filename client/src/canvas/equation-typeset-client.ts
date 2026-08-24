/**
 * Runs conversions off the main thread.
 *
 * `MathDocument.convert` is synchronous and not cheap — a 30×30 matrix takes
 * ~86 ms — and the equation panel typesets on every keystroke, on the same
 * thread that draws the canvas. Moving the work to a worker keeps typing,
 * panning and everyone else's cursors smooth no matter what one expression
 * costs.
 *
 * It is also what makes a timeout possible at all. A conversion that never
 * finishes cannot be interrupted from inside; it can only be abandoned by
 * killing the thread it occupies, which is safe to do precisely because that
 * thread holds nothing but the converter.
 *
 * Where there is no `Worker` — Node, and so the test suite — the same
 * conversion runs in-process. Only its location changes, never its result.
 */
import {
  convertEquation,
  ensureConverter,
  type EquationRender,
} from './equation-convert';
import type {
  TypesetRequest,
  TypesetResponse,
} from './equation-typeset.worker';

/**
 * How long one conversion may take before its thread is treated as wedged.
 *
 * Far above any real expression, so a legitimately enormous formula still
 * renders instead of being cut off. This is for a conversion that will never
 * finish, not a slow one.
 */
const TYPESET_TIMEOUT_MS = 5_000;

/** Warms the worker by converting something trivial, which pulls MathJax's
 *  chunks in on the worker thread rather than on the first real keystroke. */
const WARMUP_LATEX = 'x';

interface Pending {
  latex: string;
  inline: boolean;
  resolve: (render: EquationRender) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
  /** Whether this request has already survived one worker restart. A second
   *  is reported rather than retried, so two wedging expressions in flight
   *  can't bounce each other around forever. */
  retried: boolean;
}

let worker: Worker | null = null;
let warmup: Promise<void> | null = null;
let nextRequestId = 0;
const pending = new Map<number, Pending>();

function settle(id: number, render: EquationRender): void {
  const entry = pending.get(id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(id);
  entry.resolve(render);
}

function spawnWorker(): Worker {
  const created = new Worker(
    new URL('./equation-typeset.worker.ts', import.meta.url),
    { type: 'module' },
  );
  created.addEventListener(
    'message',
    (event: MessageEvent<TypesetResponse>) => {
      settle(event.data.id, event.data.render);
    },
  );
  // A worker that fails to start (or throws outside a request) answers nothing
  // ever again, so give up on the requests it was holding rather than let them
  // hang until their timeouts fire one by one.
  created.addEventListener('error', () => {
    restartWorker(new Error('The equation renderer stopped unexpectedly.'));
  });
  return created;
}

function dispatch(id: number, entry: Omit<Pending, 'timer'>): void {
  pending.set(id, { ...entry, timer: armTimeout(id) });
  worker ??= spawnWorker();
  worker.postMessage({
    id,
    latex: entry.latex,
    inline: entry.inline,
  } satisfies TypesetRequest);
}

function armTimeout(id: number): ReturnType<typeof setTimeout> {
  return setTimeout(() => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    // This expression genuinely cannot be rendered here, so it settles as an
    // ordinary render error and gets cached like any other — retrying it would
    // just wedge the next worker too.
    entry.resolve({ error: 'This equation took too long to render.' });
    restartWorker(null);
  }, TYPESET_TIMEOUT_MS);
}

/**
 * Replace the worker thread.
 *
 * `failure` is set when the worker itself broke, in which case nothing it was
 * holding can be trusted to complete. On a timeout it is null: only the one
 * request that ran out of time is at fault, and the rest were merely queued
 * behind it, so they get one run on the fresh thread.
 */
function restartWorker(failure: Error | null): void {
  worker?.terminate();
  worker = null;
  const stranded = [...pending];
  pending.clear();
  for (const [id, entry] of stranded) {
    clearTimeout(entry.timer);
    if (failure !== null || entry.retried) {
      entry.reject(
        failure ?? new Error('The equation renderer had to be restarted.'),
      );
      continue;
    }
    dispatch(id, { ...entry, retried: true });
  }
}

function typesetOffThread(
  latex: string,
  inline: boolean,
): Promise<EquationRender> {
  return new Promise<EquationRender>((resolve, reject) => {
    dispatch(nextRequestId++, {
      latex,
      inline,
      resolve,
      reject,
      retried: false,
    });
  });
}

/** True where conversions can be moved off the main thread. */
function workerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

/**
 * Typeset one expression, off the main thread where that is possible.
 *
 * Rejects only when the renderer itself is unavailable. Source that cannot be
 * typeset resolves to an `error` entry, which callers cache like any other
 * result.
 */
export function typesetOnce(
  latex: string,
  inline = false,
): Promise<EquationRender> {
  if (!workerAvailable()) {
    return ensureConverter().then(() => convertEquation(latex, inline));
  }
  return typesetOffThread(latex, inline);
}

/**
 * Start the renderer and resolve once it can typeset.
 *
 * Warming up is a real conversion because that is the only way to know the
 * worker booted *and* MathJax loaded inside it — a protocol with a separate
 * readiness message would report the first without the second.
 */
export function ensureTypesetEngine(): Promise<void> {
  warmup ??= typesetOnce(WARMUP_LATEX)
    .then(() => undefined)
    .catch((error: unknown) => {
      // Let a later attempt retry rather than caching the failure forever.
      warmup = null;
      throw error;
    });
  return warmup;
}
