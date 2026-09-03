/**
 * The mathjs parser, fetched the first time a graph needs it.
 *
 * `mathjs/number` is ~115 kB gzipped — the single largest dependency on the
 * board path, and dead weight for the boards that have no graph on them. It
 * cannot simply be awaited where it is used: `parseGraphExpression` is called
 * from a React render body and from the sampler's inner loop, neither of which
 * can suspend. So it loads in the background and the graph shape re-renders
 * when it lands, the same arrangement `equation-render` uses for typeset SVG.
 *
 * The window between a graph appearing and the chunk arriving draws the card,
 * its grid and its axes with no curves on them.
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import type { MathNode, parse } from 'mathjs/number';

export type { MathNode } from 'mathjs/number';

let parseImpl: typeof parse | null = null;
let pending: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Load the parser, once. Resolves when {@link parseMath} is callable.
 *
 * Callers that *can* wait — the graph panel's lazy boundary, PNG export —
 * await this and never see the intermediate state.
 */
export function ensureGraphMath(): Promise<void> {
  if (parseImpl) return Promise.resolve();
  pending ??= import('mathjs/number').then(({ parse }) => {
    parseImpl = parse;
    for (const listener of listeners) listener();
  });
  return pending;
}

/** Whether {@link parseMath} can be called yet. */
export function graphMathReady(): boolean {
  return parseImpl !== null;
}

/**
 * Parse an expression into a mathjs tree.
 *
 * Only legal once {@link graphMathReady} is true; `graph-parser` answers
 * "still loading" for its callers rather than letting this throw.
 */
export function parseMath(source: string): MathNode {
  if (!parseImpl) throw new Error('Graph parser is not loaded');
  return parseImpl(source);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/**
 * Start the parser loading and re-render the caller when it arrives.
 *
 * The read doubles as the server snapshot: PNG export draws shapes through
 * `renderToStaticMarkup`, and by then export has already awaited
 * {@link ensureGraphMath}, so it reads `true` there.
 */
export function useGraphMathReady(): boolean {
  const ready = useSyncExternalStore(
    useCallback(subscribe, []),
    graphMathReady,
    graphMathReady,
  );
  useEffect(() => {
    if (!ready) void ensureGraphMath();
  }, [ready]);
  return ready;
}
