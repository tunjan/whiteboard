import type { Context } from 'hono';
import { env } from './env';

/**
 * A fixed-window budget per key: `take(key, cost)` spends `cost` from the
 * key's allowance for the current window and says whether it was within it.
 * In memory, so it covers this one process — which is the only one there is.
 */
export function rateLimiter(limit: number, windowMs: number) {
  const windows = new Map<string, { start: number; spent: number }>();
  return (key: string, cost = 1): boolean => {
    const now = Date.now();
    // Expired windows are dropped in bulk rather than per lookup, so a flood
    // of one-off addresses can't grow the map without bound.
    if (windows.size > 10_000) {
      for (const [k, w] of windows) {
        if (now - w.start >= windowMs) windows.delete(k);
      }
    }
    let w = windows.get(key);
    if (!w || now - w.start >= windowMs) {
      w = { start: now, spent: 0 };
      windows.set(key, w);
    }
    w.spent += cost;
    return w.spent <= limit;
  };
}

/**
 * Who is asking, as far as this process can tell.
 *
 * Without `CLIENT_IP_HEADER` this is the socket's peer — correct when the
 * server faces the internet, but behind a proxy or tunnel every request comes
 * from the proxy and the per-client limits collapse into one shared one (safe,
 * just coarse). Set the header the proxy writes (`cf-connecting-ip` for
 * Cloudflare, `x-forwarded-for` for most others) only when the server is not
 * reachable except through that proxy — otherwise a client can name itself.
 */
export function clientIp(c: Context): string {
  if (env.clientIpHeader) {
    // For a hop chain, the last entry is the one our own proxy appended.
    // ponytail: assumes one proxy hop; a chain of two needs a hop count.
    const value = c.req.header(env.clientIpHeader)?.split(',').at(-1)?.trim();
    if (value) return value;
  }
  // What `getConnInfo` reads, minus its throw when there is no socket (tests).
  const incoming = (c.env as { incoming?: { socket?: { remoteAddress?: string } } })
    ?.incoming;
  return incoming?.socket?.remoteAddress ?? 'unknown';
}

/**
 * Bytes one client may upload per hour, shared by images and documents. Sized
 * for a tutor importing a long PDF (one image per page) rather than for a
 * typical lesson; the disk itself is bounded by `storage-quota.ts`.
 */
export const uploadBudget = rateLimiter(500 * 1024 ** 2, 60 * 60_000);
