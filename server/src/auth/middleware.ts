import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import { SESSION_COOKIE } from './routes';
import { verifySession } from './jwt';
import type { Tutor } from './tutors';

type TutorEnv = { Variables: { tutor: Tutor } };

/** Gate a route behind tutor login (the session cookie); the tutor rides on the context. */
export const requireTutor = createMiddleware<TutorEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  const tutor = token ? await verifySession(token) : null;
  if (!tutor) return c.json({ error: 'Unauthorized' }, 401);
  c.set('tutor', tutor);
  await next();
});

/** The signed-in tutor, on a route behind {@link requireTutor}. */
export const currentTutor = (c: Context): Tutor => (c as Context<TutorEnv>).get('tutor');

/** {@link requireTutor}, and only the operator. */
export const requireAdmin = createMiddleware<TutorEnv>(async (c, next) => {
  if (!c.get('tutor')?.isAdmin) return c.json({ error: 'Forbidden' }, 403);
  await next();
});
