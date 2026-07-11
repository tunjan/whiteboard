import { useId, useState, type FormEvent } from 'react';
import { login } from '@/board/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';

/** Tutor sign-in. Gates the board-management home screen. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
  const passwordId = useId();
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
    <div className="grid min-h-screen place-items-center bg-bg-muted px-6 py-10 text-content-emphasis">
      <form
        onSubmit={submit}
        className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-border-subtle bg-bg-default p-6 sm:p-8"
      >
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em]">
              Best Whiteboard
            </p>
            <h1 className="text-2xl font-semibold tracking-[-0.02em]">
              Tutor sign in
            </h1>
          </div>
        </div>

        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={passwordId}>Password</FieldLabel>
            <Input
              id={passwordId}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter tutor password"
              autoFocus
              autoComplete="current-password"
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>

        <Button type="submit" className="w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
