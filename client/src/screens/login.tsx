import { useEffect, useId, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import type { AuthConfig } from '@whiteboard/shared';
import {
  forgotPassword,
  getAuthConfig,
  login,
  resetPassword,
  signup,
} from '@/board/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { navigate } from '@/router';
import { cn } from '@/lib/utils';

type Mode = 'signin' | 'signup' | 'forgot' | 'reset';

const COPY: Record<Mode, { title: string; lead: string; action: string; busy: string }> = {
  signin: { title: 'Sign in to Whiteboard', lead: 'Manage your canvases.', action: 'Sign in', busy: 'Signing in…' },
  signup: { title: 'Create your account', lead: 'Free, with every tool except AI.', action: 'Create account', busy: 'Creating…' },
  forgot: { title: 'Reset your password', lead: 'We’ll email you a link.', action: 'Send link', busy: 'Sending…' },
  reset: { title: 'Choose a new password', lead: 'At least 8 characters.', action: 'Save password', busy: 'Saving…' },
};

const resetToken = () =>
  window.location.pathname === '/reset'
    ? new URLSearchParams(window.location.search).get('token') ?? ''
    : '';

/** Tutor sign-in, sign-up and password reset. Gates the board-management screens. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const ids = { email: useId(), name: useId(), password: useId(), error: useId() };
  const [config, setConfig] = useState<AuthConfig | null>(null);
  const [mode, setMode] = useState<Mode>(() => (resetToken() ? 'reset' : 'signin'));
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getAuthConfig().then(setConfig);
  }, []);

  const go = (next: Mode) => {
    setMode(next);
    setError(null);
    setSent(false);
  };

  // A one-tutor server keeps the old screen: the password alone.
  const askEmail = mode === 'signup' || mode === 'forgot' || (mode === 'signin' && config?.passwordOnly === false);
  const askPassword = mode !== 'forgot';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res =
      mode === 'signin'
        ? await login(password, askEmail ? email : '')
        : mode === 'signup'
          ? await signup(email, name, password)
          : mode === 'forgot'
            ? await forgotPassword(email)
            : await resetPassword(resetToken(), password);
    setBusy(false);
    if (!res.ok) return setError(res.error ?? 'Something went wrong');
    if (mode === 'forgot') return setSent(true);
    if (mode === 'reset') navigate('/');
    onSuccess();
  };

  const copy =
    mode === 'signup' && !config?.billing
      ? { ...COPY.signup, lead: 'Your own boards, shared by link.' }
      : COPY[mode];
  const field = cn(
    'h-10 w-full rounded-md border bg-surface px-3 text-base text-fg outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-fg-subtle focus-visible:ring-4',
    error
      ? 'border-danger-control-border focus-visible:ring-danger-bg'
      : 'border-border-strong hover:border-fg-subtle focus-visible:border-fg-muted focus-visible:ring-[color-mix(in_srgb,var(--fg)_8%,transparent)]',
  );
  const link = 'text-sm text-fg-muted underline-offset-4 hover:text-fg hover:underline';
  const ready =
    (!askEmail || email.trim()) && (!askPassword || password) && (mode !== 'signup' || name.trim());

  return (
    // The app frame's tone, with one white sheet on it — the same two steps
    // the signed-in shell uses, so signing in changes the content, not the room.
    <main className="grid min-h-dvh place-items-center bg-panel px-4 py-10 dark:bg-canvas font-sans text-fg">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-border bg-surface">
        <div className="flex flex-col items-center gap-3 border-b border-border px-8 pt-10 pb-8 text-center">
          <BrandMark className="size-10 rounded-xl" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-heading text-balance">{copy.title}</h1>
            <p className="text-base text-pretty text-fg-subtle">{copy.lead}</p>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-8 pt-6 pb-8">
          {sent ? (
            <p role="status" className="text-base text-fg">
              If that email has an account, a reset link is on its way. It works for an hour.
            </p>
          ) : mode === 'forgot' && config && !config.resetByEmail ? (
            <p className="text-base text-fg">
              This server can’t send email. Ask whoever runs it to reset your password with{' '}
              <code className="font-mono text-sm">npm run tutor:password</code>.
            </p>
          ) : (
            <>
              {mode === 'signup' && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={ids.name} className="text-base font-medium text-fg">
                    Name
                  </label>
                  <input
                    id={ids.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    autoFocus
                    className={field}
                  />
                </div>
              )}
              {askEmail && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={ids.email} className="text-base font-medium text-fg">
                    Email
                  </label>
                  <input
                    id={ids.email}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoFocus={mode !== 'signup'}
                    className={field}
                  />
                </div>
              )}
              {askPassword && (
                <div className="flex flex-col gap-2">
                  <label htmlFor={ids.password} className="text-base font-medium text-fg">
                    {mode === 'reset' ? 'New password' : 'Password'}
                  </label>
                  <div className="relative">
                    <input
                      id={ids.password}
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus={!askEmail}
                      autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={error ? ids.error : undefined}
                      className={cn(field, error && 'pr-10')}
                    />
                    {error ? (
                      <AlertCircle
                        aria-hidden
                        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-danger-fg"
                      />
                    ) : null}
                  </div>
                </div>
              )}
              {error ? (
                <p id={ids.error} role="alert" className="text-sm text-danger-fg">
                  {error}
                </p>
              ) : null}

              <Button
                type="submit"
                disabled={busy || !ready}
                className="h-10 w-full gap-2 rounded-lg border-inverse bg-inverse px-3 text-base text-fg-inverse hover:bg-inverse-hover hover:ring-4 hover:ring-border-subtle disabled:border-border disabled:bg-panel disabled:text-fg-subtle disabled:opacity-100"
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                {busy ? copy.busy : copy.action}
                {busy ? null : (
                  <Kbd className="hidden bg-fg-inverse/15 text-fg-inverse/85 group-disabled/button:bg-border group-disabled/button:text-fg-subtle md:inline-flex">
                    ↵
                  </Kbd>
                )}
              </Button>
            </>
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            {mode === 'signin' ? (
              <>
                {config?.signups ? (
                  <button type="button" className={link} onClick={() => go('signup')}>
                    Create an account
                  </button>
                ) : null}
                <button type="button" className={link} onClick={() => go('forgot')}>
                  Forgot password?
                </button>
              </>
            ) : (
              <button type="button" className={link} onClick={() => go('signin')}>
                Back to sign in
              </button>
            )}
            {config?.demo ? (
              <a href="/demo" className={link}>
                Try the demo
              </a>
            ) : null}
          </div>
        </div>
      </form>
    </main>
  );
}
