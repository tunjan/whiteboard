/**
 * The main thread's view of typeset equations: a bounded cache that shape
 * components can read synchronously during render, and a per-expression
 * subscription that tells them when their own entry changed.
 *
 * The conversion itself happens elsewhere (`equation-typeset-client`, normally
 * on a worker thread). Only the cache lives here, because a React render body
 * cannot await anything — `getEquationRender` has to answer immediately or not
 * at all.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { EquationRender } from './equation-convert';
import { ensureTypesetEngine, typesetOnce } from './equation-typeset-client';
import { persistRender, readPersistedRender } from './equation-persist';

export type { EquationRender };

/**
 * What one cached render is of: an expression *and* the style it was typeset
 * in, since the same source produces different geometry in each.
 *
 * Display math keeps the bare source as its key. It is what an equation is
 * unless someone asked otherwise, and this key is rebuilt on every render of
 * every equation on the board — so the common case allocates nothing, and only
 * the exception carries a prefix.
 */
function renderKey(latex: string, inline: boolean): string {
  return inline ? `\u0000inline\u0000${latex}` : latex;
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

function cacheEntryBytes(key: string, entry: EquationRender): number {
  const content = entry.error ?? entry.svg ?? '';
  return (key.length + content.length) * 2;
}

/** Mark `key` as most recently used. Map iterates in insertion order, so
 *  re-inserting moves it to the back of the eviction queue. */
function touch(key: string, entry: EquationRender): void {
  renderCache.delete(key);
  renderCache.set(key, entry);
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
    // A shape still showing this expression has to hear about it, or it would
    // keep the evicted render on screen until something else re-rendered it.
    notify(oldest);
  }
}

/**
 * Who to tell when one expression's cache entry changes, keyed by that
 * expression.
 *
 * A single version counter would be less code, but the panel caches a new
 * render on *every keystroke* — one per abandoned prefix — and a shared counter
 * turns each of those into a re-render of every equation on the board. On a
 * dense document that is what makes typing LaTeX feel sluggish, so a shape
 * subscribes to its own expression and nothing else.
 */
const listeners = new Map<string, Set<() => void>>();

function notify(key: string): void {
  const subscribers = listeners.get(key);
  if (!subscribers) return;
  // Snapshot: a listener may unsubscribe while we iterate.
  // oxlint-disable-next-line unicorn/no-useless-spread
  for (const listener of [...subscribers]) listener();
}

function subscribe(key: string, listener: () => void): () => void {
  let subscribers = listeners.get(key);
  if (!subscribers) {
    subscribers = new Set();
    listeners.set(key, subscribers);
  }
  subscribers.add(listener);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

/**
 * Run `listener` when one expression's cache entry appears or is evicted.
 * Returns an unsubscribe function. For callers outside React; components use
 * {@link useEquationRender}.
 */
export function subscribeEquationRender(
  latex: string,
  inline: boolean,
  listener: () => void,
): () => void {
  return subscribe(renderKey(latex, inline), listener);
}

/** The em `convertEquation` typesets at. Dividing by it turns MathJax's pixel
 *  geometry into `em`, so math scales with whatever text it sits in. */
const MATHJAX_BASE_PX = 16;

/**
 * A render's box in `em` of the surrounding text, for setting math inline.
 *
 * `depth` is how much of the formula hangs below the baseline of the line it
 * sits on. MathJax reports this as a `vertical-align` style, which the
 * sanitizer strips (see `equation-convert`), so it is recovered from the
 * viewBox instead: the box runs from `minY` above the baseline to
 * `minY + height` below it. Without it every parenthesis, subscript and
 * fraction in a sentence would float, resting its *bottom* on the baseline.
 */
export function inlineMathBox(render: { svg: string; width: number; height: number }): {
  width: number;
  height: number;
  depth: number;
} {
  const viewBox = /viewBox="\s*[-\d.]+\s+(-?[\d.]+)\s+[-\d.]+\s+([\d.]+)/.exec(
    render.svg,
  );
  const height = render.height / MATHJAX_BASE_PX;
  const boxTop = Number(viewBox?.[1]);
  const boxHeight = Number(viewBox?.[2]);
  const depth =
    Number.isFinite(boxTop) && boxHeight > 0
      ? ((boxTop + boxHeight) / boxHeight) * height
      : 0;
  return { width: render.width / MATHJAX_BASE_PX, height, depth };
}

/**
 * Synchronously read an already-typeset expression.
 *
 * Reading also refreshes the entry's recency, which is what keeps the
 * expressions currently on screen (re-read on every render) ahead of abandoned
 * editing prefixes in the eviction order. This mutates only the cache's
 * internal ordering — never the entry, and never the subscribers that drive
 * re-rendering — so it stays safe to call from a component body.
 */
export function getEquationRender(
  latex: string,
  inline = false,
): EquationRender | undefined {
  const key = renderKey(latex, inline);
  const entry = renderCache.get(key);
  if (entry) touch(key, entry);
  return entry;
}

/**
 * The cache entry for one expression, re-rendering the caller when *that*
 * expression's entry appears or is evicted — and never for anyone else's.
 *
 * Reading through the hook also refreshes recency, the same way
 * `getEquationRender` does, so expressions on screen stay ahead of abandoned
 * editing prefixes in the eviction order. An empty `latex` is a legal argument
 * (it never has an entry), so a caller with nothing to show still calls the
 * hook unconditionally.
 */
export function useEquationRender(
  latex: string,
  inline = false,
): EquationRender | undefined {
  const key = renderKey(latex, inline);
  // The same read serves as the server snapshot. Without one React throws
  // under `renderToStaticMarkup` — which is how PNG export draws every shape,
  // equations included — and the cache is a plain module-level Map that reads
  // identically on either path.
  const read = useCallback(() => renderCache.get(key), [key]);
  const entry = useSyncExternalStore(
    useCallback((onChange: () => void) => subscribe(key, onChange), [key]),
    // A cache entry is immutable, so its identity is the snapshot: React can
    // compare it across calls without anything being re-created per render.
    read,
    read,
  );
  if (entry) touch(key, entry);
  return entry;
}

function cacheRender(key: string, render: EquationRender): EquationRender {
  const existing = renderCache.get(key);
  if (existing) {
    touch(key, existing);
    return existing;
  }
  const entryBytes = cacheEntryBytes(key, render);
  evictFor(entryBytes);
  renderCache.set(key, render);
  renderCacheBytes += entryBytes;
  notify(key);
  return render;
}

/**
 * Typeset and cache one expression.
 *
 * Concurrent callers asking for the same LaTeX — several shapes showing it, an
 * export prewarming while the panel types — share one conversion.
 */
export function typesetEquation(
  latex: string,
  inline = false,
): Promise<EquationRender> {
  const key = renderKey(latex, inline);
  const cached = renderCache.get(key);
  if (cached) {
    touch(key, cached);
    return Promise.resolve(cached);
  }
  const existing = inFlight.get(key);
  if (existing) return existing;

  const request = readPersistedRender(key)
    .then(
      (stored) =>
        stored ??
        typesetOnce(latex, inline).then((render) => {
          persistRender(key, render);
          return render;
        }),
    )
    .then((render) => cacheRender(key, render))
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, request);
  return request;
}

/**
 * Schedule a cache fill without updating a zustand store during React render.
 * Multiple mounted shapes requesting the same LaTeX share one conversion.
 */
export function requestEquationTypeset(latex: string, inline = false): void {
  const key = renderKey(latex, inline);
  if (renderCache.has(key) || inFlight.has(key)) return;
  void Promise.resolve()
    .then(() => typesetEquation(latex, inline))
    .catch(() => undefined);
}

/** Start the renderer, so it is warm before the first equation needs it. */
export function ensureEquationRenderer(): Promise<void> {
  return ensureTypesetEngine();
}
