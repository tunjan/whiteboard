import { describe, expect, it, vi } from 'vitest';

const config = vi.hoisted(() => ({ signups: false }));

vi.mock('../env', async (actual) => {
  const { env } = await actual<typeof import('../env')>();
  return {
    env: new Proxy(env, {
      get: (target, key) => (key === 'signups' ? config.signups : target[key as keyof typeof env]),
    }),
  };
});

vi.mock('./tutors', () => ({
  countTutors: async () => 1,
  tutorByEmail: async () => undefined,
  createTutor: async (input: { email: string; name: string }) =>
    input.email === 'taken@example.com'
      ? undefined
      : { id: 'new', email: input.email, name: input.name, plan: 'free', isAdmin: false, sessionVersion: 0 },
}));

import { authRoutes } from './routes';

const signup = (body: Record<string, string>) =>
  authRoutes.request('http://x/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': String(Math.random()) },
    body: JSON.stringify(body),
  });

const valid = { email: 'ada@example.com', name: 'Ada', password: 'long-enough' };

describe('POST /signup', () => {
  it('is closed unless SIGNUPS=open', async () => {
    config.signups = false;
    expect((await signup(valid)).status).toBe(403);
  });

  it('creates the account and signs it in', async () => {
    config.signups = true;
    const res = await signup(valid);
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('wb_session=');
    expect(await res.json()).toMatchObject({ authenticated: true, plan: 'free' });
  });

  it('refuses a bad email, a short password and a taken email', async () => {
    config.signups = true;
    expect((await signup({ ...valid, email: 'not-an-email' })).status).toBe(400);
    expect((await signup({ ...valid, password: 'short' })).status).toBe(400);
    expect((await signup({ ...valid, email: 'taken@example.com' })).status).toBe(409);
  });
});
