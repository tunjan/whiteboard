import type { AuthConfig, AuthMe, Plan } from '@whiteboard/shared';

export interface AuthState {
  authenticated: boolean;
  name?: string;
  email?: string;
  plan?: Plan;
  isAdmin?: boolean;
}

/** Current tutor auth state (via the HttpOnly session cookie). */
export async function getAuth(): Promise<AuthState> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AuthMe;
  } catch {
    return { authenticated: false };
  }
}

const NO_CONFIG: AuthConfig = {
  signups: false,
  passwordOnly: true,
  billing: false,
  demo: false,
  resetByEmail: false,
};

/** What the login screen offers on this server. */
export async function getAuthConfig(): Promise<AuthConfig> {
  try {
    const res = await fetch('/api/auth/config', { credentials: 'include' });
    return res.ok ? ((await res.json()) as AuthConfig) : NO_CONFIG;
  } catch {
    return NO_CONFIG;
  }
}

type Result = { ok: boolean; error?: string };

/** POST to an auth route; the server's message becomes the error. */
async function post(path: string, body: unknown): Promise<Result> {
  try {
    const res = await fetch(`/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(body),
    });
    if (res.ok) return { ok: true };
    const answer = (await res.json().catch(() => null)) as { error?: string } | null;
    if (res.status === 429) {
      return { ok: false, error: 'Too many attempts. Try again in a few minutes.' };
    }
    return { ok: false, error: answer?.error ?? 'Something went wrong' };
  } catch {
    return { ok: false, error: 'Cannot reach the server' };
  }
}

/** Email may be empty on a one-tutor server, where the password alone signs in. */
export const login = (password: string, email = '') =>
  post('login', { email: email || undefined, password });

export const signup = (email: string, name: string, password: string) =>
  post('signup', { email, name, password });

export const forgotPassword = (email: string) => post('forgot', { email });

export const resetPassword = (token: string, password: string) =>
  post('reset', { token, password });

export async function logout(): Promise<void> {
  // The cached board list is this tutor's; the next one to sign in on this
  // browser must not see it. (The offline outbox stays: the server refuses
  // anything in it that isn't the signed-in tutor's.)
  try {
    localStorage.removeItem('whiteboard:boards-cache');
  } catch {
    // Storage blocked: nothing was cached either.
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore
  }
}
