import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { LiteDocument } from 'mathjax-full/js/adaptors/lite/Document.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import type { LiteText } from 'mathjax-full/js/adaptors/lite/Text.js';
import { create } from 'zustand';

const BASE_EM = 16;
const BASE_EX = 8;

export type EquationRender =
  | {
      svg: string;
      width: number;
      height: number;
      error?: never;
    }
  | {
      svg?: never;
      width?: never;
      height?: never;
      error: string;
    };

interface MathJaxRuntime {
  adaptor: LiteAdaptor;
  document: MathDocument<LiteElement, LiteText, LiteDocument>;
}

interface EquationRenderState {
  version: number;
}

const renderCache = new Map<string, EquationRender>();
/**
 * Bound on typeset expressions held in memory.
 *
 * The equation panel typesets on every keystroke so one document patch can
 * carry both the source and its measured geometry — which means each abandoned
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
const inFlight = new Map<string, Promise<EquationRender>>();

/** Mark `latex` as most recently used. Map iterates in insertion order, so
 *  re-inserting moves it to the back of the eviction queue. */
function touch(latex: string, entry: EquationRender): void {
  renderCache.delete(latex);
  renderCache.set(latex, entry);
}

function evictIfFull(): void {
  while (renderCache.size >= RENDER_CACHE_MAX) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) return;
    renderCache.delete(oldest);
  }
}
let runtime: MathJaxRuntime | null = null;
let loadPromise: Promise<void> | null = null;

export const useEquationRenderStore = create<EquationRenderState>(() => ({
  version: 0,
}));

function publishCacheChange(): void {
  useEquationRenderStore.setState((state) => ({
    version: state.version + 1,
  }));
}

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

function exLengthToPixels(value: unknown, attribute: string): number {
  const raw = typeof value === 'string' ? value.trim() : '';
  const match = /^(-?\d+(?:\.\d+)?)ex$/.exec(raw);
  const ex = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isFinite(ex) || ex <= 0) {
    throw new Error(`MathJax returned an invalid ${attribute}`);
  }
  return ex * BASE_EX;
}

async function loadMathJax(): Promise<void> {
  const [
    { mathjax },
    { TeX },
    { SVG },
    { liteAdaptor },
    { RegisterHTMLHandler },
    { AllPackages },
  ] = await Promise.all([
    import('mathjax-full/js/mathjax.js'),
    import('mathjax-full/js/input/tex.js'),
    import('mathjax-full/js/output/svg.js'),
    import('mathjax-full/js/adaptors/liteAdaptor.js'),
    import('mathjax-full/js/handlers/html.js'),
    import('mathjax-full/js/input/tex/AllPackages.js'),
  ]);

  const adaptor = liteAdaptor();
  RegisterHTMLHandler(adaptor);
  const input = new TeX({
    packages: AllPackages.filter(
      (name) => name !== 'require' && name !== 'autoload',
    ),
    formatError: (_jax: unknown, error: unknown) => {
      throw error;
    },
  });
  const output = new SVG({ fontCache: 'none' });
  const document = mathjax.document('', {
    InputJax: input,
    OutputJax: output,
  }) as MathDocument<LiteElement, LiteText, LiteDocument>;

  runtime = { adaptor, document };
}

/** Lazily initialize the MathJax SVG pipeline once. */
export function ensureMathJax(): Promise<void> {
  if (runtime) return Promise.resolve();
  if (!loadPromise) {
    loadPromise = loadMathJax().catch((error: unknown) => {
      loadPromise = null;
      throw error;
    });
  }
  return loadPromise;
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

function convertAndCache(latex: string): EquationRender {
  const cached = renderCache.get(latex);
  if (cached) {
    touch(latex, cached);
    return cached;
  }
  if (!runtime) throw new Error('MathJax is not ready');

  let entry: EquationRender;
  try {
    const container = runtime.document.convert(latex, {
      display: true,
      em: BASE_EM,
      ex: BASE_EX,
    }) as LiteElement;
    const svg = runtime.adaptor.firstChild(container) as LiteElement;
    const width = exLengthToPixels(
      runtime.adaptor.getAttribute(svg, 'width'),
      'width',
    );
    const height = exLengthToPixels(
      runtime.adaptor.getAttribute(svg, 'height'),
      'height',
    );

    // The shape renderer supplies a numeric viewport. Keeping MathJax's ex
    // attributes here would make canvas size depend on the surrounding font.
    runtime.adaptor.removeAttribute(svg, 'width');
    runtime.adaptor.removeAttribute(svg, 'height');
    entry = {
      svg: runtime.adaptor.outerHTML(svg),
      width,
      height,
    };
  } catch (error) {
    entry = { error: errorMessage(error) };
  }

  evictIfFull();
  renderCache.set(latex, entry);
  publishCacheChange();
  return entry;
}

/**
 * Typeset and cache one expression. Once MathJax is ready, conversion and the
 * cache write happen synchronously before the returned promise resolves.
 */
export function typesetEquation(latex: string): Promise<EquationRender> {
  const cached = renderCache.get(latex);
  if (cached) {
    touch(latex, cached);
    return Promise.resolve(cached);
  }
  if (runtime) return Promise.resolve(convertAndCache(latex));
  return ensureMathJax().then(() => convertAndCache(latex));
}

/**
 * Schedule a cache fill without updating a zustand store during React render.
 * Multiple mounted shapes requesting the same LaTeX share one conversion.
 */
export function requestEquationTypeset(latex: string): void {
  if (renderCache.has(latex) || inFlight.has(latex)) return;
  const pending = Promise.resolve()
    .then(() => typesetEquation(latex))
    .finally(() => {
      inFlight.delete(latex);
    });
  inFlight.set(latex, pending);
  void pending.catch(() => undefined);
}
