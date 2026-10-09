import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { clientIp, rateLimiter } from './rate-limit';

/**
 * Crashes and uncaught errors from browsers, written to the server log so a
 * white screen on a student's iPad leaves a trace somewhere the operator looks.
 * Open, since students are the ones who hit them; what arrives is logged and
 * nothing else, so the caps below are only about keeping the log readable.
 *
 * ponytail: the log is the sink. Forward to Sentry or similar from here if
 * nobody reads the log.
 */
export const clientErrorRoutes = new Hono();

const reportLimit = rateLimiter(10, 60_000);

const field = (value: unknown, max: number) =>
  typeof value === 'string' ? value.slice(0, max) : undefined;

clientErrorRoutes.post('/', bodyLimit({ maxSize: 16 * 1024 }), async (c) => {
  if (!reportLimit(clientIp(c))) return c.body(null, 429);
  const body = (await c.req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const message = field(body?.message, 1000);
  if (!message) return c.body(null, 400);
  console.error('[client-error]', {
    message,
    url: field(body?.url, 500),
    stack: field(body?.stack, 4000),
    componentStack: field(body?.componentStack, 4000),
    userAgent: c.req.header('user-agent')?.slice(0, 300),
  });
  return c.body(null, 204);
});
