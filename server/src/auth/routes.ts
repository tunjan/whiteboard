import { Hono, type Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AuthConfig, AuthMe } from '@whiteboard/shared';
import { env } from '../env';
import { MIN_PASSWORD_LENGTH, hashPassword, verifyPassword } from './password';
import { signSession, verifySession } from './jwt';
import { resetByEmail, sendResetEmail } from './email';
import {
  countTutors,
  createTutor,
  issueResetToken,
  setPassword,
  tutorByEmail,
  tutorByResetToken,
  type Tutor,
} from './tutors';
import { requestOrigin } from '../app-shell';
import { clientIp, rateLimiter } from '../rate-limit';
import { db } from '../db/client';
import { tutors } from '../db/schema';

export const SESSION_COOKIE = 'wb_session';
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;

export const authRoutes = new Hono();

/**
 * Attempts per client per window, for every route that takes a password or
 * sends an email. Every attempt counts, not just failures: a tutor signs in
 * about once a week.
 */
const attemptLimit = rateLimiter(10, 15 * 60_000);

/** One tutor and no sign-ups: the login screen asks for the password alone. */
async function passwordOnly(): Promise<boolean> {
  return !env.signups && (await countTutors()) === 1;
}

async function startSession(c: Context, tutor: Tutor) {
  setCookie(c, SESSION_COOKIE, await signSession(tutor), {
    httpOnly: true,
    sameSite: 'Lax',
    // Over HTTPS (directly or behind a TLS-terminating proxy) the cookie must
    // never travel in clear. Plain-HTTP dev and LAN use can't set a `Secure`
    // cookie at all in some browsers, so it follows the request's scheme.
    secure: requestOrigin(c.req.url, c.req.header('x-forwarded-proto')).startsWith('https:'),
    path: '/',
    maxAge: COOKIE_MAX_AGE,
  });
}

const me = (tutor: Tutor): AuthMe => ({
  authenticated: true,
  name: tutor.name,
  email: tutor.email,
  plan: tutor.plan === 'pro' ? 'pro' : 'free',
  isAdmin: tutor.isAdmin,
});

// Spent on a login for an email with no account, so the answer takes as long
// as a wrong password and says nothing about who has one.
const decoy = hashPassword('decoy-password');

const str = (value: unknown) => (typeof value === 'string' ? value : '');

authRoutes.get('/config', async (c) =>
  c.json({
    signups: env.signups,
    passwordOnly: await passwordOnly(),
    billing: Boolean(env.stripeSecretKey),
    demo: env.demo,
    resetByEmail: resetByEmail(),
  } satisfies AuthConfig),
);

authRoutes.post('/login', async (c) => {
  if (!attemptLimit(clientIp(c))) {
    return c.json({ error: 'Too many attempts, try again later' }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const password = str(body.password);
  let tutor = str(body.email) ? await tutorByEmail(str(body.email)) : undefined;
  if (!str(body.email) && (await passwordOnly())) {
    [tutor] = await db.select().from(tutors).limit(1);
  }
  const ok = tutor
    ? await verifyPassword(password, tutor.passwordHash)
    : await verifyPassword(password, await decoy).then(() => false);
  if (!tutor || !ok) return c.json({ error: 'Invalid email or password' }, 401);
  await startSession(c, tutor);
  return c.json(me(tutor));
});

authRoutes.post('/signup', async (c) => {
  if (!env.signups) return c.json({ error: 'Sign-ups are closed' }, 403);
  if (!attemptLimit(clientIp(c))) {
    return c.json({ error: 'Too many attempts, try again later' }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const email = str(body.email).trim();
  const name = str(body.name).trim().slice(0, 80);
  const password = str(body.password);
  // ponytail: emails are not verified. Add a confirmation link if fake sign-ups appear.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return c.json({ error: 'Enter a valid email' }, 400);
  }
  if (!name) return c.json({ error: 'Enter your name' }, 400);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }
  const tutor = await createTutor({ email, name, password });
  if (!tutor) return c.json({ error: 'That email already has an account' }, 409);
  await startSession(c, tutor);
  return c.json(me(tutor));
});

// Always the same answer, so it can't be used to find out who has an account.
authRoutes.post('/forgot', async (c) => {
  if (!attemptLimit(clientIp(c))) {
    return c.json({ error: 'Too many attempts, try again later' }, 429);
  }
  if (!resetByEmail()) return c.json({ error: 'Ask the server admin to reset it' }, 501);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const tutor = await tutorByEmail(str(body.email));
  if (tutor) {
    const token = await issueResetToken(tutor.id);
    await sendResetEmail(tutor.email, token).catch((error: unknown) =>
      console.error('[auth] reset email failed', error),
    );
  }
  return c.json({ ok: true });
});

authRoutes.post('/reset', async (c) => {
  if (!attemptLimit(clientIp(c))) {
    return c.json({ error: 'Too many attempts, try again later' }, 429);
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const password = str(body.password);
  if (password.length < MIN_PASSWORD_LENGTH) {
    return c.json({ error: `Use at least ${MIN_PASSWORD_LENGTH} characters` }, 400);
  }
  const tutor = await tutorByResetToken(str(body.token));
  if (!tutor) return c.json({ error: 'This link has expired. Ask for a new one.' }, 400);
  const updated = await setPassword(tutor.id, password);
  if (updated) await startSession(c, updated);
  return c.json({ ok: true });
});

authRoutes.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

authRoutes.get('/me', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  const tutor = token ? await verifySession(token) : null;
  if (!tutor) return c.json({ authenticated: false } satisfies AuthMe);
  return c.json(me(tutor));
});
