export interface AuthState {
  authenticated: boolean;
  name?: string;
}

/** Current tutor auth state (via the HttpOnly session cookie). */
export async function getAuth(): Promise<AuthState> {
  try {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    if (!res.ok) return { authenticated: false };
    return (await res.json()) as AuthState;
  } catch {
    return { authenticated: false };
  }
}

export async function login(
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ password }),
    });
    if (res.ok) return { ok: true };
    if (res.status === 401) return { ok: false, error: 'Incorrect password' };
    return { ok: false, error: 'Login failed' };
  } catch {
    return { ok: false, error: 'Cannot reach the server' };
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    // ignore
  }
}
