/**
 * OpenGraph / HTML metadata extraction for link unfurling.
 *
 * Deliberately a scanner over the document head rather than a full HTML parse:
 * the server only needs four fields out of the first few kilobytes, and nothing
 * extracted here is ever executed or reflected — the title and description are
 * rendered as SVG text, and the image URLs are re-validated and re-fetched
 * before anything is stored.
 */

export interface LinkMeta {
  title?: string;
  description?: string;
  /** Absolute preview image URL, resolved against the page URL. */
  image?: string;
  /** Absolute site icon URL, resolved against the page URL. */
  favicon?: string;
}

/** Attributes of one tag, lowercased keys, entity-decoded values. */
function tagAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag))) {
    attrs[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return attrs;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  '#39': "'",
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named) return named;
    if (body.startsWith('#')) {
      const code = body[1] === 'x' || body[1] === 'X'
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff) {
        try {
          return String.fromCodePoint(code);
        } catch {
          return whole;
        }
      }
    }
    return whole;
  });
}

/** Collapse the whitespace real-world `<meta>` content is full of, and cap it. */
function clean(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 400;

/** Resolve a possibly-relative asset reference against the page URL. */
function absolute(value: string | undefined, pageUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    const resolved = new URL(value, pageUrl);
    return resolved.protocol === 'http:' || resolved.protocol === 'https:'
      ? resolved.href
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Extract preview metadata from an HTML document. Prefers OpenGraph, then
 * Twitter cards, then the plain document `<title>` / description — the order
 * sites themselves treat as most to least intentional.
 */
export function parseLinkMeta(html: string, pageUrl: string): LinkMeta {
  // Everything of interest lives in the head; stopping at </head> also keeps a
  // <meta> inside body content from overriding the real one.
  const headEnd = html.search(/<\/head\s*>/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);

  const metas: Record<string, string> = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    const key = (attrs.property ?? attrs.name)?.toLowerCase();
    const content = attrs.content;
    // First writer wins: duplicated og tags are usually a template artifact,
    // and the earlier one is the page's own.
    if (key && content && metas[key] === undefined) metas[key] = content;
  }

  const icons: Record<string, string> = {};
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = tagAttributes(tag);
    const rel = attrs.rel?.toLowerCase();
    if (!rel || !attrs.href) continue;
    for (const token of rel.split(/\s+/)) {
      if (icons[token] === undefined) icons[token] = attrs.href;
    }
  }

  const documentTitle = decodeEntities(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '',
  );

  return {
    title: clean(
      metas['og:title'] ?? metas['twitter:title'] ?? documentTitle,
      TITLE_MAX,
    ),
    description: clean(
      metas['og:description'] ??
        metas['twitter:description'] ??
        metas['description'],
      DESCRIPTION_MAX,
    ),
    image: absolute(
      metas['og:image'] ??
        metas['og:image:url'] ??
        metas['og:image:secure_url'] ??
        metas['twitter:image'] ??
        metas['twitter:image:src'],
      pageUrl,
    ),
    favicon: absolute(
      icons['apple-touch-icon'] ??
        icons['apple-touch-icon-precomposed'] ??
        icons['icon'] ??
        icons['shortcut'] ??
        // Sites that publish no <link rel="icon"> still answer /favicon.ico,
        // but that format isn't storable — leave it to the card's fallback.
        undefined,
      pageUrl,
    ),
  };
}
