import { afterEach, describe, expect, it, vi } from 'vitest';
import { rateLimiter } from './rate-limit';
import { authRoutes } from './auth/routes';

// No accounts: every attempt is a wrong password, which is all this suite counts.
vi.mock('./auth/tutors', () => ({
  countTutors: async () => 0,
  tutorByEmail: async () => undefined,
}));

afterEach(() => vi.useRealTimers());

describe('rateLimiter', () => {
  it('spends a per-key budget and refills it each window', () => {
    vi.useFakeTimers();
    const take = rateLimiter(10, 1000);
    expect(take('a', 6)).toBe(true);
    expect(take('a', 4)).toBe(true);
    expect(take('a')).toBe(false);
    expect(take('b', 10)).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(take('a', 10)).toBe(true);
  });
});

describe('POST /api/auth/login', () => {
  const attempt = (url = 'http://x/login') =>
    authRoutes.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'definitely-wrong' }),
    });

  it('stops answering after ten attempts', async () => {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await attempt()).status);
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});
