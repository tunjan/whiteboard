import { useId, useState, type FormEvent } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { login } from '@/board/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';

/** Tutor sign-in. Gates the board-management home screen. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const passwordId = useId();
  const errorId = useId();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await login(password);
    setBusy(false);
    if (res.ok) onSuccess();
    else setError(res.error ?? 'Login failed');
  };

  return (
    // The app frame's tone, with one white sheet on it — the same two steps
    // the signed-in shell uses, so signing in changes the content, not the room.
    <main className="grid min-h-dvh place-items-center bg-panel px-4 py-10 dark:bg-canvas font-sans text-fg">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-2xl border border-border bg-surface"
      >
        <div className="flex flex-col items-center gap-3 border-b border-border px-8 pt-10 pb-8 text-center">
          <BrandMark className="size-10 rounded-xl" />
          <div className="flex flex-col gap-1">
            <h1 className="text-lg font-semibold tracking-heading text-balance">
              Sign in to Whiteboard
            </h1>
            <p className="text-base text-pretty text-fg-subtle">
              Enter the tutor password to manage your canvases.
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-4 px-8 pt-6 pb-8">
          <div className="flex flex-col gap-2">
            <label
              htmlFor={passwordId}
              className="text-base font-medium text-fg"
            >
              Password
            </label>
            <div className="relative">
              <input
                id={passwordId}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tutor password"
                autoFocus
                autoComplete="current-password"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                className={cn(
                  'h-10 w-full rounded-md border bg-surface px-3 text-base text-fg outline-none transition-[border-color,box-shadow] duration-100 placeholder:text-fg-subtle focus-visible:ring-4',
                  error
                    ? 'border-danger-control-border pr-10 focus-visible:ring-danger-bg'
                    : 'border-border-strong hover:border-fg-subtle focus-visible:border-fg-muted focus-visible:ring-[color-mix(in_srgb,var(--fg)_8%,transparent)]',
                )}
              />
              {error ? (
                <AlertCircle
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-danger-fg"
                />
              ) : null}
            </div>
            {error ? (
              <p id={errorId} role="alert" className="text-sm text-danger-fg">
                {error}
              </p>
            ) : null}
          </div>

          <Button
            type="submit"
            disabled={busy || !password}
            className="h-10 w-full gap-2 rounded-lg border-inverse bg-inverse px-3 text-base text-fg-inverse hover:bg-inverse-hover hover:ring-4 hover:ring-border-subtle disabled:border-border disabled:bg-panel disabled:text-fg-subtle disabled:opacity-100"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {busy ? 'Signing in…' : 'Sign in'}
            {busy ? null : (
              <Kbd className="hidden bg-fg-inverse/15 text-fg-inverse/85 group-disabled/button:bg-border group-disabled/button:text-fg-subtle md:inline-flex">
                ↵
              </Kbd>
            )}
          </Button>
        </div>
      </form>
    </main>
  );
}
