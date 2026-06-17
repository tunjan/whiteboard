import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from './routes';
import { verifySession } from './jwt';

/** Gate a route behind tutor login (the session cookie). */
export const requireTutor = createMiddleware(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await verifySession(token) : null;
  if (!session) return c.json({ error: 'Unauthorized' }, 401);
  await next();
});
