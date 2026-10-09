import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Guarded outbound fetching for link unfurling.
 *
 * The URL being fetched comes from a client, so this is a server-side request
 * forgery surface: without checks, pasting `http://169.254.169.254/...` or
 * `http://localhost:5433` would let anyone use the server as a probe into the
 * private network it runs in. Every hostname — including each redirect hop — is
 * resolved and rejected unless it lands on a public address, and every response
 * is bounded in time and size.
 */

/** Redirect hops followed before giving up. */
const MAX_REDIRECTS = 4;

/** Wall-clock budget for one hop. */
const TIMEOUT_MS = 6000;

// Presenting as a browser matters: a lot of sites serve no OpenGraph tags (or
// no response at all) to unrecognized agents.
const USER_AGENT =
  'Mozilla/5.0 (compatible; WhiteboardBot/1.0; +link-preview)';

export interface RemoteResponse {
  body: Buffer;
  /** Lowercased media type, parameters stripped. */
  contentType: string;
  /** URL of the final hop, for resolving relative asset paths. */
  finalUrl: string;
}

export class BlockedHostError extends Error {}

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map(Number);
  return bytes.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ? bytes
    : null;
}

/** Ranges that are not reachable public internet destinations. */
function isPrivateIpv4(bytes: number[]): boolean {
  const [a, b] = bytes as [number, number, number, number];
  return (
    a === 0 || // this network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    (a === 169 && b === 254) || // link-local, incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 0) || // IETF protocol assignments
    (a === 192 && b === 168) || // private
    (a === 198 && b >= 18 && b <= 19) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

/** Expand an IPv6 literal to its 16 bytes, or null if unparseable. */
function parseIpv6(ip: string): number[] | null {
  const text = ip.split('%')[0]!.toLowerCase();
  const [head, tail, ...rest] = text.split('::');
  if (rest.length > 0) return null;

  const expand = (part: string | undefined): number[] | null => {
    if (!part) return [];
    const bytes: number[] = [];
    const groups = part.split(':');
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i]!;
      // A trailing dotted quad (`::ffff:127.0.0.1`) occupies the last 4 bytes.
      if (group.includes('.')) {
        if (i !== groups.length - 1) return null;
        const v4 = parseIpv4(group);
        if (!v4) return null;
        bytes.push(...v4);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      const value = Number.parseInt(group, 16);
      bytes.push(value >> 8, value & 0xff);
    }
    return bytes;
  };

  const left = expand(head);
  const right = tail === undefined ? [] : expand(tail);
  if (!left || !right) return null;
  if (tail === undefined) return left.length === 16 ? left : null;

  const gap = 16 - left.length - right.length;
  if (gap < 0) return null;
  return [...left, ...Array.from<number>({ length: gap }).fill(0), ...right];
}

function isPrivateIpv6(bytes: number[]): boolean {
  const isZero = (from: number, to: number) =>
    bytes.slice(from, to).every((b) => b === 0);

  if (isZero(0, 15)) return true; // unspecified and loopback
  if (bytes[0] === 0xff) return true; // multicast
  if ((bytes[0]! & 0xfe) === 0xfc) return true; // unique local
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return true; // link-local
  // IPv4-mapped (`::ffff:10.0.0.1`) inherits the v4 rules.
  if (isZero(0, 10) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return isPrivateIpv4(bytes.slice(12));
  }
  return false;
}

function isPrivateAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const bytes = parseIpv4(address);
    return !bytes || isPrivateIpv4(bytes);
  }
  if (family === 6) {
    const bytes = parseIpv6(address);
    return !bytes || isPrivateIpv6(bytes);
  }
  return true;
}

/**
 * Reject a hostname that resolves anywhere private.
 *
 * This resolves the name and the request resolves it again, so a DNS entry that
 * changes between the two calls could still slip through (classic rebinding).
 * Closing that fully means pinning the checked address for the connection,
 * which Node's fetch doesn't expose; the check still stops the direct cases
 * (literal IPs, `localhost`, names pointed at internal hosts).
 */
async function assertPublicHost(hostname: string): Promise<void> {
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (isIP(literal)) {
    if (isPrivateAddress(literal)) {
      throw new BlockedHostError(`Blocked address: ${hostname}`);
    }
    return;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new BlockedHostError(`Cannot resolve host: ${hostname}`);
  }
  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new BlockedHostError(`Blocked address: ${hostname}`);
  }
}

/** Read a response body, aborting once it exceeds `maxBytes`. */
async function readCapped(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(Buffer.from(value));
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks);
}

/**
 * Fetch a public http(s) URL, following redirects manually so every hop is
 * re-checked. Returns null when the request fails or the body exceeds
 * `maxBytes`; throws {@link BlockedHostError} when a hop targets a private
 * address.
 */
export async function fetchPublicUrl(
  url: string,
  { accept, maxBytes }: { accept: string; maxBytes: number },
): Promise<RemoteResponse | null> {
  let current = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let target: URL;
    try {
      target = new URL(current);
    } catch {
      return null;
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new BlockedHostError(`Blocked protocol: ${target.protocol}`);
    }
    await assertPublicHost(target.hostname);

    let response: Response;
    try {
      response = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          accept,
          'accept-language': 'en',
          'user-agent': USER_AGENT,
        },
      });
    } catch {
      return null;
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      if (!location) return null;
      current = new URL(location, target).href;
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      return null;
    }

    const body = await readCapped(response, maxBytes);
    if (!body) return null;
    return {
      body,
      contentType: (response.headers.get('content-type') ?? '')
        .split(';')[0]!
        .trim()
        .toLowerCase(),
      finalUrl: target.href,
    };
  }
  return null;
}

export const testing = { isPrivateAddress, parseIpv6 };
