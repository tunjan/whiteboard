/**
 * The main thread's view of typeset equations: a bounded cache that shape
 * components can read synchronously during render, and a store that tells them
 * when it changed.
 *
 * The conversion itself happens elsewhere (`equation-typeset-client`, normally
 * on a worker thread). Only the cache lives here, because a React render body
 * cannot await anything — `getEquationRender` has to answer immediately or not
 * at all.
 */
import { create } from 'zustand';
import type { EquationRender } from './equation-convert';
import {
  ensureTypesetEngine,
  typesetOnce,
} from './equation-typeset-client';

export type { EquationRender };

interface EquationRenderState {
  version: number;
}

const renderCache = new Map<string, EquationRender>();
let renderCacheBytes = 0;
/**
 * Bound on typeset expressions held in memory.
 *
 * The equation panel typesets on every keystroke, which means each abandoned
 * prefix of an expression being edited ("\fra", "\frac", "\frac{") leaves its
 * own multi-kilobyte SVG string behind. Unbounded, a long editing session grew
 * this without limit.
 *
 * Eviction is safe because an entry is a pure function of its LaTeX: a miss
 * renders the placeholder and re-typesets (see `equationUtil.Component`). The
 * limit must stay comfortably above the number of equations that can be on
 * screen at once, or visible shapes would evict each other and re-typeset in a
 * loop; a few hundred distinct expressions in one viewport is far beyond any
 * real document.
 */
const RENDER_CACHE_MAX = 512;
// Entry count alone does not protect against a handful of very long equations
// retaining megabytes of generated SVG. This is an approximate UTF-16 budget,
// intentionally conservative rather than an exact heap measurement.
const RENDER_CACHE_MAX_BYTES = 16 * 1024 * 1024;
const inFlight = new Map<string, Promise<EquationRender>>();

function cacheEntryBytes(latex: string, entry: EquationRender): number {
  const content = entry.error ?? entry.svg ?? '';
  return (latex.length + content.length) * 2;
}

/** Mark `latex` as most recently used. Map iterates in insertion order, so
 *  re-inserting moves it to the back of the eviction queue. */
function touch(latex: string, entry: EquationRender): void {
  renderCache.delete(latex);
  renderCache.set(latex, entry);
}

function evictFor(entryBytes: number): void {
  while (
    renderCache.size >= RENDER_CACHE_MAX ||
    (renderCache.size > 0 &&
      renderCacheBytes + entryBytes > RENDER_CACHE_MAX_BYTES)
  ) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) return;
    const entry = renderCache.get(oldest);
    if (entry) renderCacheBytes -= cacheEntryBytes(oldest, entry);
    renderCache.delete(oldest);
  }
}

export const useEquationRenderStore = create<EquationRenderState>(() => ({
  version: 0,
}));

function publishCacheChange(): void {
  useEquationRenderStore.setState((state) => ({
    version: state.version + 1,
  }));
}

/**
 * Synchronously read an already-typeset expression.
 *
 * Reading also refreshes the entry's recency, which is what keeps the
 * expressions currently on screen (re-read on every render) ahead of abandoned
 * editing prefixes in the eviction order. This mutates only the cache's
 * internal ordering — never the entry, and never the store version that drives
 * re-rendering — so it stays safe to call from a component body.
 */
export function getEquationRender(latex: string): EquationRender | undefined {
  const entry = renderCache.get(latex);
  if (entry) touch(latex, entry);
  return entry;
}

function cacheRender(latex: string, render: EquationRender): EquationRender {
  const existing = renderCache.get(latex);
  if (existing) {
    touch(latex, existing);
    return existing;
  }
  const entryBytes = cacheEntryBytes(latex, render);
  evictFor(entryBytes);
  renderCache.set(latex, render);
  renderCacheBytes += entryBytes;
  publishCacheChange();
  return render;
}

/**
 * Typeset and cache one expression.
 *
 * Concurrent callers asking for the same LaTeX — several shapes showing it, an
 * export prewarming while the panel types — share one conversion.
 */
export function typesetEquation(latex: string): Promise<EquationRender> {
  const cached = renderCache.get(latex);
  if (cached) {
    touch(latex, cached);
    return Promise.resolve(cached);
  }
  const existing = inFlight.get(latex);
  if (existing) return existing;

  const request = typesetOnce(latex)
    .then((render) => cacheRender(latex, render))
    .finally(() => {
      inFlight.delete(latex);
    });
  inFlight.set(latex, request);
  return request;
}

/**
 * Schedule a cache fill without updating a zustand store during React render.
 * Multiple mounted shapes requesting the same LaTeX share one conversion.
 */
export function requestEquationTypeset(latex: string): void {
  if (renderCache.has(latex) || inFlight.has(latex)) return;
  void Promise.resolve()
    .then(() => typesetEquation(latex))
    .catch(() => undefined);
}

/** Start the renderer, so it is warm before the first equation needs it. */
export function ensureEquationRenderer(): Promise<void> {
  return ensureTypesetEngine();
}
