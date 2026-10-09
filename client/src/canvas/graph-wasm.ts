/**
 * The Rust graph evaluator (client/graph-wasm), in front of mathjs.
 *
 * mathjs dispatches on type for every operator, and sampling an implicit plot
 * calls it ~77k times per redraw; the compiled Rust program measured ~4x faster
 * end to end (graph-eval.bench.ts). It covers arithmetic, `^`, constants,
 * sliders and the built-in functions. Anything it can't compile — `%`, `sum`,
 * `int`, user functions, min/max with three arguments — returns null here and
 * the parser keeps its mathjs evaluator, as it does until the module loads.
 *
 * `graph-eval.wasm` is committed so builds don't need cargo; regenerate it
 * with `npm run build:graph-wasm` after editing the crate.
 */
import type { GraphParameter } from '@whiteboard/shared';
import initGraphWasm from './graph-eval.wasm?init';
import { DEFAULT_GRAPH_PARAMETER } from './graph-defaults';

interface GraphWasm {
  memory: WebAssembly.Memory;
  input_ptr(len: number): number;
  declare_param(): void;
  compile(): number;
  set_param(handle: number, slot: number, value: number): void;
  eval(handle: number, x: number, y: number): number;
  release(handle: number): void;
}

let wasm: GraphWasm | null = null;
let pending: Promise<void> | null = null;
let enabled = true;

const encoder = new TextEncoder();
const released = new FinalizationRegistry<number>((handle) =>
  wasm?.release(handle),
);

/** Load the module, once. Never rejects: a failed load just means mathjs. */
export function ensureGraphWasm(): Promise<void> {
  pending ??= initGraphWasm()
    .then((instance) => {
      wasm = instance.exports as unknown as GraphWasm;
    })
    .catch(() => {});
  return pending;
}

/** Whether evaluators bind to Rust. Off routes everything through mathjs. */
export function graphWasmActive(): boolean {
  return enabled && wasm !== null;
}

/** For the benchmark and tests: force the mathjs path. */
export function setGraphWasmEnabled(value: boolean): void {
  enabled = value;
}

function writeInput(module: GraphWasm, text: string): void {
  const bytes = encoder.encode(text);
  // input_ptr may grow memory, so read `buffer` only after it returns.
  const at = module.input_ptr(bytes.length);
  new Uint8Array(module.memory.buffer, at, bytes.length).set(bytes);
}

export interface GraphWasmProgram {
  /** A Rust evaluator bound to these slider values, or null for mathjs. */
  bind(
    parameters: Record<string, GraphParameter>,
  ): ((x: number, y: number) => number) | null;
}

/**
 * One expression, compiled the first time it is bound after the module loads.
 *
 * The program has one set of parameter slots, so each bound evaluator re-writes
 * its values when it isn't the last one to have run. Two shapes plotting the
 * same text with different sliders share the parse cache entry and this.
 */
export function graphWasmProgram(
  source: string,
  parameterNames: readonly string[],
): GraphWasmProgram {
  // undefined: not tried yet; -1: unsupported, stay on mathjs.
  let handle: number | undefined;
  let active: object | null = null;
  const program: GraphWasmProgram = {
    bind(parameters) {
      if (!enabled || !wasm) return null;
      const module = wasm;
      if (handle === undefined) {
        for (const name of parameterNames) {
          writeInput(module, name);
          module.declare_param();
        }
        writeInput(module, source);
        handle = module.compile();
        // Released when `program` is collected. A bound evaluator keeps it
        // alive: it closes over `active`, which shares this scope with it.
        if (handle >= 0) released.register(program, handle);
      }
      if (handle < 0) return null;
      const h = handle;
      const values = parameterNames.map(
        (name) => parameters[name]?.value ?? DEFAULT_GRAPH_PARAMETER.value,
      );
      const token = {};
      return (x, y) => {
        if (active !== token) {
          for (let slot = 0; slot < values.length; slot += 1) {
            module.set_param(h, slot, values[slot]!);
          }
          active = token;
        }
        return module.eval(h, x, y);
      };
    },
  };
  return program;
}
