/**
 * The SPA shell that every non-asset route is served from.
 *
 * The one thing the shell cannot say for itself is where it lives: link
 * unfurlers (Slack, iMessage, and this app's own /api/links) will not reliably
 * resolve a relative `og:image`, and the deploy origin isn't known when the
 * client is built. So `client/index.html` ships the preview image as a
 * site-root path and it is made absolute here, against the origin the request
 * actually arrived on — correct on localhost, on a LAN address and in
 * production without any of them being configured.
 */

/** Hosts are `example.com`, `example.com:3001` or `[::1]:3001`. */
const HOST = /^[A-Za-z0-9.\-:[\]]+$/;

/**
 * The origin to advertise, preferring what a reverse proxy says it served —
 * behind one, the request Hono sees is plain HTTP to an internal host.
 *
 * The forwarded headers are attacker-controllable, so both are validated and
 * only ever steer the preview URLs in the response to that same request.
 */
export function requestOrigin(
  requestUrl: string,
  forwardedProto?: string,
  forwardedHost?: string,
): string {
  const url = new URL(requestUrl);
  // Each header can carry a chain of hops; the first is the original client's.
  const proto = forwardedProto?.split(',')[0]!.trim().toLowerCase();
  const host = forwardedHost?.split(',')[0]!.trim();
  return `${proto === 'http' || proto === 'https' ? proto : url.protocol.slice(0, -1)}://${
    host && HOST.test(host) ? host : url.host
  }`;
}

/** Rewrite the preview image tags' site-root paths to absolute URLs. */
export function absolutePreviewUrls(html: string, origin: string): string {
  return html.replace(/<meta\b[^>]*>/gi, (tag) =>
    /(?:property|name)="(?:og:image|twitter:image)"/i.test(tag)
      ? tag.replace(/content="\/([^"]*)"/i, `content="${origin}/$1"`)
      : tag,
  );
}
