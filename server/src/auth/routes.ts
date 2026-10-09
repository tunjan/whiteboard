import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../env';
import { checkPassword } from './password';
import { signSession, verifySession } from './jwt';
import { requestOrigin } from '../app-shell';
import { clientIp, rateLimiter } from '../rate-limit';

export const SESSION_COOKIE = 'wb_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export const authRoutes = new Hono();

/**
 * Login attempts per client per window. The password is the only credential,
 * so this is what turns guessing it from minutes into centuries. Every attempt
 * counts, not just failures: the tutor signs in about once a week.
 */
const loginLimit = rateLimiter(10, 15 * 60_000);

authRoutes.post('/login', async (c) => {
  if (!loginLimit(clientIp(c))) {
    return c.json({ error: 'Too many attempts, try again later' }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof body.password !== 'string' || !checkPassword(body.password)) {
    return c.json({ error: 'Invalid password' }, 401);
  }
  const token = await signSession({ role: 'tutor', name: env.tutorName });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    // Over HTTPS (directly or behind a TLS-terminating proxy) the cookie must
    // never travel in clear. Plain-HTTP dev and LAN use can't set a `Secure`
    // cookie at all in some browsers, so it follows the request's scheme.
    secure: requestOrigin(c.req.url, c.req.header('x-forwarded-proto')).startsWith(
      'https:',
    ),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
  return c.json({ authenticated: true, name: env.tutorName });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const session = token ? await verifySession(token) : null;
  if (!session) return c.json({ authenticated: false });
  return c.json({ authenticated: true, name: session.name });
});
