/**
 * Resolving `var(--name)` for consumers that the page's cascade doesn't reach.
 *
 * Shapes write their colors as presentation attributes holding Tailwind theme
 * vars (`fill="var(--color-border)"`). That works on the live board because the
 * shape tree is in the document. It does not work for the PNG export, whose SVG
 * is detached and can't see the page stylesheet, nor for the camera snapshot,
 * whose Canvas 2D context has no notion of a custom property at all.
 */

// A resolved value may itself contain `var()` (a theme var aliasing a raw one,
// or a `color-mix` built from them), so resolution loops. This bounds it.
const MAX_PASSES = 5;

const VAR_RE = /var\(\s*(--[\w-]+)\s*(?:,\s*([^()]*))?\)/g;

/** Replace every `var(--name[, fallback])` token in `input` with its value. */
export function resolveCssVars(input: string): string {
  return createCssVarResolver()(input);
}

/**
 * A resolver that reads the root computed style once and memoizes both the
 * custom properties it looks up and the strings it has already resolved.
 *
 * The snapshot capture calls this for the paint attribute of every element it
 * transcribes; a `getComputedStyle` per call would cost more than the drawing
 * does. Hold one only for as long as the theme can't change under it — a
 * single capture, a single export.
 */
export function createCssVarResolver(): (input: string) => string {
  const root = getComputedStyle(document.documentElement);
  const values = new Map<string, string>();
  const resolved = new Map<string, string>();

  // Theme vars (`--color-border`) alias raw ones (`--border`); when the alias
  // isn't itself a resolvable custom property, strip the `color-` prefix.
  const read = (name: string): string => {
    const cached = values.get(name);
    if (cached !== undefined) return cached;
    let v = root.getPropertyValue(name).trim();
    if (!v && name.startsWith('--color-')) {
      v = root.getPropertyValue(`--${name.slice('--color-'.length)}`).trim();
    }
    values.set(name, v);
    return v;
  };

  return (input: string): string => {
    if (!input.includes('var(')) return input;
    const cached = resolved.get(input);
    if (cached !== undefined) return cached;
    let out = input;
    for (let i = 0; i < MAX_PASSES && out.includes('var('); i++) {
      out = out.replace(
        VAR_RE,
        (_m, name: string, fallback?: string) =>
          read(name) || (fallback?.trim() ?? ''),
      );
    }
    resolved.set(input, out);
    return out;
  };
}
