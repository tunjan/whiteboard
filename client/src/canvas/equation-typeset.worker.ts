/**
 * Worker entry: the only place a conversion actually runs in the browser.
 *
 * Intentionally thin — every decision (caching, timeouts, restarts) belongs to
 * `equation-typeset-client`, so that a failure here is always a failure of the
 * conversion itself and never of the plumbing around it.
 */
import {
  convertEquation,
  ensureConverter,
  type EquationRender,
} from './equation-convert';

export interface TypesetRequest {
  id: number;
  latex: string;
}

export interface TypesetResponse {
  id: number;
  render: EquationRender;
}

/**
 * `self` is typed as a `Window` here because the app's `lib` is DOM — pulling
 * in the webworker lib to fix that would redefine `self` for every other file
 * in the program. A local structural type is cheaper and says exactly what
 * this module uses.
 */
interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<TypesetRequest>) => void,
  ): void;
  postMessage(message: TypesetResponse): void;
}

const scope = self as unknown as WorkerScope;

scope.addEventListener('message', (event: MessageEvent<TypesetRequest>) => {
  const { id, latex } = event.data;
  void ensureConverter()
    .then(() => convertEquation(latex))
    // Only the MathJax load itself can reject; a TeX failure is already an
    // `error` entry. Reporting it as one keeps the client's protocol total —
    // every request gets exactly one response.
    .catch(
      (error: unknown): EquationRender => ({
        error:
          error instanceof Error
            ? error.message
            : 'The equation renderer could not be loaded.',
      }),
    )
    .then((render) => {
      scope.postMessage({ id, render });
    });
});
