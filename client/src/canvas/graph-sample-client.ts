/**
 * Samples graph curves off the main thread.
 *
 * Sampling an implicit curve evaluates its expression ~65k times. Through the
 * Rust evaluator that is ~5 ms, but anything it can't compile — a user
 * function, `sum`, `int` — falls back to mathjs and measured 410–570 ms per
 * redraw (420×280 and 1200×800 cards), on every viewport pan, slider step and
 * animation frame. In a worker that cost no longer blocks drawing and input.
 *
 * While a sample is in flight the graph keeps drawing the curves it last had,
 * matched by expression id, so a pan or a slider shows the old curve for a
 * frame instead of none. Each graph keeps at most one request in flight and
 * sends only its newest inputs when that one returns, so a slider sweeping
 * faster than the worker can sample skips frames rather than queueing them.
 *
 * Intersections ride along in the same request: root finding re-evaluates
 * every explicit curve, so it costs the same mathjs fallback the curves do.
 *
 * Where there is no `Worker` (Node, so the test suite) and in a static render
 * (PNG export via `renderToStaticMarkup`, which has no effects to wait on),
 * sampling runs inline exactly as before.
 */
import {
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
} from 'react';
import type {
  GraphExpression,
  GraphParameter,
  GraphViewport,
} from '@whiteboard/shared';
import {
  findGraphIntersections,
  type IntersectionPoint,
} from './graph-intersections';
import {
  createGraphFunctionDefinitions,
  type GraphFunctionDefinitions,
} from './graph-parser';
import { sampleGraphExpression, type GraphSampleResult } from './graph-sampler';
import type {
  GraphSampleRequest,
  GraphSampleResponse,
} from './graph-sample.worker';

export interface GraphSampleInput {
  expressions: GraphExpression[];
  viewport: GraphViewport;
  parameters: Record<string, GraphParameter>;
  samples: number;
  verticalSamples: number;
  /** Whether to also find intersections (the shape's `showIntersections`). */
  intersections: boolean;
}

export interface GraphSampleOutput {
  /** One per `input.expressions` entry, in order. */
  results: GraphSampleResult[];
  intersections: IntersectionPoint[];
}

/** Samples per curve for intersection root finding. */
const INTERSECTION_SAMPLES = 240;

export interface GraphCurve {
  expression: GraphExpression;
  result: GraphSampleResult;
}

export interface GraphCurves {
  curves: GraphCurve[];
  intersections: IntersectionPoint[];
}

const EMPTY: GraphSampleResult = { ok: true, segments: [] };

/**
 * Finished samples, shared by every graph. Lets a graph that is culled and
 * remounted on pan, or a slider that returns to a value, draw at once.
 */
const CACHE_LIMIT = 64;
const cache = new Map<string, GraphSampleOutput>();

function remember(key: string, output: GraphSampleOutput): void {
  cache.delete(key);
  cache.set(key, output);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** The whole job, wherever it runs. The worker calls this too. */
export function sampleGraph(
  input: GraphSampleInput,
  definitions: GraphFunctionDefinitions,
): GraphSampleOutput {
  return {
    results: input.expressions.map((expression) =>
      sampleGraphExpression(
        expression,
        input.viewport,
        input.parameters,
        input.samples,
        input.verticalSamples,
        definitions,
      ),
    ),
    intersections: input.intersections
      ? findGraphIntersections(
          input.expressions,
          input.viewport,
          input.parameters,
          INTERSECTION_SAMPLES,
          definitions,
        )
      : [],
  };
}

let worker: Worker | null = null;
let nextRequestId = 0;
const pending = new Map<
  number,
  { resolve: (output: GraphSampleOutput) => void; reject: () => void }
>();

function spawnWorker(): Worker {
  const created = new Worker(
    new URL('./graph-sample.worker.ts', import.meta.url),
    { type: 'module' },
  );
  created.addEventListener(
    'message',
    (event: MessageEvent<GraphSampleResponse>) => {
      pending.get(event.data.id)?.resolve(event.data.output);
      pending.delete(event.data.id);
    },
  );
  // A worker that broke answers nothing again; hand its requests back so
  // they sample inline, and start a fresh thread for the next one.
  created.addEventListener('error', () => {
    created.terminate();
    if (worker === created) worker = null;
    for (const entry of pending.values()) entry.reject();
    pending.clear();
  });
  return created;
}

// ponytail: no timeout — an expression that never finishes wedges the worker
// (it used to wedge the page). Add the equation client's timeout+restart if
// one shows up.
function sampleOffThread(input: GraphSampleInput): Promise<GraphSampleOutput> {
  return new Promise((resolve, reject) => {
    const id = nextRequestId++;
    pending.set(id, { resolve, reject });
    worker ??= spawnWorker();
    worker.postMessage({ id, input } satisfies GraphSampleRequest);
  });
}

const subscribeNever = () => () => {};

/**
 * Curves for one graph shape. `definitions` must be built from
 * `input.expressions`; `mathReady` is `useGraphMathReady()`.
 */
export function useGraphCurves(
  input: GraphSampleInput,
  definitions: GraphFunctionDefinitions,
  mathReady: boolean,
): GraphCurves {
  // False in the browser, true under renderToStaticMarkup.
  const isStatic = useSyncExternalStore(
    subscribeNever,
    () => false,
    () => true,
  );
  const offThread =
    mathReady && !isStatic && typeof Worker !== 'undefined';
  const key = JSON.stringify(input);

  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const alive = useRef(true);
  const busy = useRef(false);
  const wanted = useRef<{ key: string; input: GraphSampleInput } | null>(null);
  const shown = useRef<{
    byId: Map<string, GraphSampleResult>;
    intersections: IntersectionPoint[];
  } | null>(null);

  let output = cache.get(key);
  if (!output && !offThread) {
    output = sampleGraph(input, definitions);
    // Before the parser lands every curve reads as unparsable; don't keep that.
    if (mathReady) remember(key, output);
  }

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!offThread || cache.has(key)) return;
    wanted.current = { key, input };
    if (busy.current) return;
    const pump = () => {
      const job = wanted.current;
      if (!job) return;
      wanted.current = null;
      busy.current = true;
      void sampleOffThread(job.input)
        .catch(() =>
          sampleGraph(job.input, createGraphFunctionDefinitions(job.input.expressions)),
        )
        .then((sampled) => {
          remember(job.key, sampled);
          busy.current = false;
          if (!alive.current) return;
          rerender();
          if (wanted.current && cache.has(wanted.current.key)) {
            wanted.current = null;
          }
          pump();
        });
    };
    pump();
    // `key` is `input`, serialized.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, offThread]);

  if (output) {
    const { results, intersections } = output;
    shown.current = {
      byId: new Map(
        input.expressions.map((expression, index) => [expression.id, results[index]!]),
      ),
      intersections,
    };
    return {
      curves: input.expressions.map((expression, index) => ({
        expression,
        result: results[index]!,
      })),
      intersections,
    };
  }
  const last = shown.current;
  return {
    curves: input.expressions.map((expression) => ({
      expression,
      result: (expression.visible && last?.byId.get(expression.id)) || EMPTY,
    })),
    // Switching intersections off shouldn't wait on the worker.
    intersections: input.intersections ? (last?.intersections ?? []) : [],
  };
}
