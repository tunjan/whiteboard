/**
 * URL extraction and protocol validation for pasted links.
 *
 * Two rules run the whole subsystem:
 *   - only `http:`/`https:` ever becomes a shape, so a pasted `javascript:` or
 *     `data:` string can't be turned into something clickable;
 *   - the check is repeated wherever a stored URL is opened or rendered
 *     ({@link safeLinkUrl}), because shape props arrive from the CRDT and a
 *     peer — or a tampered document — is not a trusted source.
 */

/** Protocols a link shape may ever carry. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

export function isValidHttpUrl(value: string): boolean {
  try {
    return ALLOWED_PROTOCOLS.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Split pasted text on whitespace and return the links, or null if any
 * non-empty token isn't an http(s) URL. All-or-nothing on purpose: prose that
 * merely mentions a link should paste as text (or fall through to the in-app
 * clipboard), not explode into cards.
 */
export function extractHttpUrls(text: string): string[] | null {
  const tokens = text.split(/[\n\s]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  for (const token of tokens) {
    if (!isValidHttpUrl(token)) return null;
  }
  return [...new Set(tokens)];
}

/**
 * Read the href out of a clipboard `text/html` payload that is a single anchor.
 *
 * Several browsers (notably Edge on Windows) put a copied link on the clipboard
 * as `<a href="...">...</a>` wrapped in a container element, with the plain-text
 * flavor carrying the link's *text* rather than its target. Only the
 * single-anchor shape is treated as a link paste; anything richer is real HTML
 * content and none of this subsystem's business.
 */
export function urlFromHtmlClipboard(html: string): string | null {
  if (!html.trim() || typeof DOMParser === 'undefined') return null;
  let body: HTMLElement;
  try {
    body = new DOMParser().parseFromString(html, 'text/html').body;
  } catch {
    return null;
  }
  const children = body.children;
  // Unwrap the wrapper elements browsers add around the anchor.
  let node: Element | null = children.length === 1 ? children[0]! : null;
  while (node && node.tagName !== 'A' && node.children.length === 1) {
    node = node.children[0]!;
  }
  if (!node || node.tagName !== 'A') return null;
  const href = node.getAttribute('href');
  return href && isValidHttpUrl(href) ? href : null;
}

/**
 * The URLs a clipboard payload should paste as link cards, or null when it
 * isn't a link paste. Plain text wins when it parses, since it carries the
 * target verbatim; the HTML flavor is the fallback for the anchor case above.
 */
export function linkUrlsFromClipboard(
  text: string,
  html: string,
): string[] | null {
  const fromText = extractHttpUrls(text);
  if (fromText) return fromText;
  const fromHtml = urlFromHtmlClipboard(html);
  return fromHtml ? [fromHtml] : null;
}

/**
 * A stored URL if it is still safe to navigate to, else null. Call this at
 * every point of use rather than trusting `props.url` — see the module note.
 */
export function safeLinkUrl(url: string): string | null {
  return isValidHttpUrl(url) ? url : null;
}

/** Host shown on a link card, with the noise (`www.`) trimmed. */
export function linkHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
