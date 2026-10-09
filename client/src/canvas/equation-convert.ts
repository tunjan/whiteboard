/**
 * The MathJax pipeline: bootstrap, TeX → SVG, and the sanitizing that makes the
 * result safe to inject as markup.
 *
 * Deliberately free of the cache, the React store and the worker plumbing, so
 * it can run unchanged on either side of `postMessage` — the worker imports it
 * to do the work, and `equation-typeset-client` imports it directly wherever
 * there is no `Worker` (Node, and so the test suite).
 */
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { LiteDocument } from 'mathjax-full/js/adaptors/lite/Document.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import type { LiteText } from 'mathjax-full/js/adaptors/lite/Text.js';

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

let runtime: MathJaxRuntime | null = null;
let loadPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return String(error);
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

/**
 * Attributes that would turn a static formula into live markup once it is
 * injected with `dangerouslySetInnerHTML`.
 *
 * `latex` reaches this module from the shared document, so an expression can
 * have been written by any collaborator on the board — the rendered SVG is
 * untrusted content, not something this client authored.
 *
 * The one exception is MathJax's own glyph cache: `fontCache: 'local'` defines
 * each glyph once as `<path id="MJX-…">` and draws it with `<use
 * xlink:href="#MJX-…">`, which `isGlyphReference` lets through. The only
 * `style` MathJax produces is a `vertical-align` hint that neither consumer
 * uses (SVG has no inline layout, and the panel preview sets `display: block`).
 */
const UNSAFE_ATTRIBUTES = new Set(['href', 'xlink:href', 'style', 'id']);

/**
 * MathJax glyph ids are `MJX-<n>-<font>-<variant>-<codepoint>`, so the same id
 * always names the same glyph. That is what makes ids repeated across the many
 * formulas in one page harmless: whichever definition `#MJX-…` resolves to
 * draws the same outline. Nothing a collaborator types can produce one — the
 * `html` package that could set `id` is excluded — and this pattern keeps it
 * that way: no other id, and no reference that leaves the document.
 */
const GLYPH_ID = /^MJX-[\w-]+$/;

function isGlyphReference(
  element: string,
  attribute: string,
  value: string,
): boolean {
  if (attribute === 'id') return element === 'path' && GLYPH_ID.test(value);
  if (attribute !== 'href' && attribute !== 'xlink:href') return false;
  return (
    element === 'use' &&
    value.startsWith('#') &&
    GLYPH_ID.test(value.slice(1))
  );
}

/** SVG elements that execute, animate, or embed foreign content. */
const UNSAFE_ELEMENTS = new Set([
  'script',
  'foreignobject',
  'animate',
  'animatetransform',
  'set',
]);

/**
 * Strip anything executable from a converted formula.
 *
 * The TeX package list already drops `html`, the one package whose commands
 * (`\href`, `\style`, `\cssId`) emit these. This is the second line: a package
 * added later, or a MathJax release that moves a command between packages,
 * cannot quietly put a `javascript:` link or a colliding `id` into the DOM.
 *
 * Working on the parsed tree rather than the markup string keeps this honest —
 * a regex over serialized HTML disagrees with the parser exactly where an
 * attacker wants it to.
 */
function sanitizeRenderTree(adaptor: LiteAdaptor, node: LiteElement): void {
  const element = adaptor.kind(node).toLowerCase();
  for (const { name, value } of adaptor.allAttributes(node)) {
    const lower = name.toLowerCase();
    if (
      lower.startsWith('on') ||
      (UNSAFE_ATTRIBUTES.has(lower) &&
        !isGlyphReference(element, lower, value))
    ) {
      adaptor.removeAttribute(node, name);
    }
  }
  for (const child of adaptor.childNodes(node)) {
    if (adaptor.kind(child).startsWith('#')) continue;
    const element = child as LiteElement;
    if (UNSAFE_ELEMENTS.has(adaptor.kind(element).toLowerCase())) {
      adaptor.remove(element);
      continue;
    }
    sanitizeRenderTree(adaptor, element);
  }
}

function decodeMathJaxAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

/** MathJax represents some TeX failures (notably undefined commands) as an
 * inline merror node instead of throwing through `formatError`. Treat those as
 * real errors so the panel and assistive technology receive the same status as
 * they do for missing braces and environments. */
function embeddedMathJaxError(svg: string): string | null {
  const match = /data-mjx-error=(?:"([^"]*)"|'([^']*)')/.exec(svg);
  const message = match?.[1] ?? match?.[2];
  return message ? decodeMathJaxAttribute(message) : null;
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
      (name) =>
        name !== 'require' &&
        name !== 'autoload' &&
        // `noundefined` intentionally paints unknown commands as red text.
        // The editor needs a real error instead so it can explain, announce,
        // and exclude invalid content consistently.
        name !== 'noundefined' &&
        // `html` provides \href, \style and \cssId, which pass an author's
        // string straight through to an attribute of the generated SVG. That
        // SVG is injected as markup, and the LaTeX behind it can come from any
        // collaborator on the board — so the package turns a shared document
        // into a way to run script (`\href{javascript:…}`), inject CSS, or
        // clobber the ids the panel uses to label its own fields. Nothing in a
        // whiteboard formula needs them. `sanitizeRenderTree` re-checks the
        // output in case a later release moves these elsewhere.
        name !== 'html',
    ),
    macros: {
      // MathLive writes an unfilled slot as `\placeholder{}` — from a template
      // the panel inserted, or from any structure the virtual keyboard built.
      // MathJax has never heard of the command, so without this every equation
      // with an empty slot failed to typeset with "Undefined control sequence"
      // while the user was still filling it in. Rendering it as its (empty)
      // argument leaves the gap where the slot is.
      placeholder: ['{#1}', 1],
    },
    formatError: (_jax: unknown, error: unknown) => {
      throw error;
    },
  });
  // `local` defines each glyph once per formula and reuses it with `<use>`: a
  // 30×30 matrix is 0.5 MB of markup instead of 2.1 MB, ordinary formulas ~10%
  // smaller. Each render stays self-contained, so export needs no extra defs.
  const output = new SVG({ fontCache: 'local' });
  const document = mathjax.document('', {
    InputJax: input,
    OutputJax: output,
  }) as MathDocument<LiteElement, LiteText, LiteDocument>;

  runtime = { adaptor, document };
}

/** Lazily initialize the MathJax SVG pipeline once, on whichever thread this
 *  module was loaded into. */
export function ensureConverter(): Promise<void> {
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
 * Typeset one expression. Requires `ensureConverter` to have resolved.
 *
 * `inline` selects TeX's text style over display style, which is a decision
 * about the *typesetting* rather than about the source: the same LaTeX renders
 * with limits beside `\sum` instead of above it, and with smaller fractions.
 * Both are legitimate renders of the same expression, so both are cached.
 *
 * A TeX failure comes back as an `error` entry rather than throwing: invalid
 * source is an ordinary, cacheable outcome here, not an exception.
 */
export function convertEquation(latex: string, inline = false): EquationRender {
  if (!runtime) throw new Error('MathJax is not ready');
  try {
    const container = runtime.document.convert(latex, {
      display: !inline,
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
    sanitizeRenderTree(runtime.adaptor, svg);
    const markup = runtime.adaptor.outerHTML(svg);
    const embeddedError = embeddedMathJaxError(markup);
    return embeddedError
      ? { error: embeddedError }
      : { svg: markup, width, height };
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
