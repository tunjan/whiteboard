import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../env';
import { checkPassword } from './password';
import { signSession, verifySession } from './jwt';

export const SESSION_COOKIE = 'wb_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export const authRoutes = new Hono();

authRoutes.post('/login', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { password?: unknown };
  if (typeof body.password !== 'string' || !checkPassword(body.password)) {
    return c.json({ error: 'Invalid password' }, 401);
  }
  const token = await signSession({ role: 'tutor', name: env.tutorName });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
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
