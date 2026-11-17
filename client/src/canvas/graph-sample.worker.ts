/**
 * Worker entry: samples a graph's curves and intersections off the main thread.
 *
 * Intentionally thin — scheduling, caching and fallbacks belong to
 * `graph-sample-client`. Function definitions are rebuilt here from the
 * expressions rather than sent over, since they hold compiled evaluators that
 * can't be cloned across threads.
 */
import { ensureGraphMath } from './graph-math';
import { createGraphFunctionDefinitions } from './graph-parser';
import {
  packGraphSample,
  sampleGraph,
  type GraphSampleInput,
  type PackedGraphSampleOutput,
} from './graph-sample-client';

export interface GraphSampleRequest {
  id: number;
  input: GraphSampleInput;
}

export interface GraphSampleResponse {
  id: number;
  output: PackedGraphSampleOutput;
}

/** See `equation-typeset.worker.ts`: the app's `lib` types `self` as Window. */
interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<GraphSampleRequest>) => void,
  ): void;
  postMessage(message: GraphSampleResponse, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event) => {
  const { id, input } = event.data;
  // A failed parser load still answers: every curve then reads as unparsable,
  // which is what the main thread would have drawn too.
  void ensureGraphMath().catch(() => undefined).then(() => {
    const output = packGraphSample(
      sampleGraph(
        input,
        createGraphFunctionDefinitions(input.expressions, input.angleUnit),
      ),
    );
    scope.postMessage({ id, output }, [output.coords.buffer]);
  });
});
