import { useId, useState, type FormEvent } from 'react';
import { login } from '@/board/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
    <div className="grid min-h-dvh place-items-center px-4 py-10 sm:px-6">
      <Card className="w-full max-w-sm">
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-6">
            <div className="flex flex-col items-start gap-6">
              <div className="flex items-center gap-2.5">
                <BrandMark className="size-7" />
                <p className="text-sm font-semibold">Best Whiteboard</p>
              </div>
              <div className="grid gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  Tutor Sign In
                </h1>
                <p className="text-pretty text-sm text-muted-foreground">
                  Enter the tutor password to create and manage whiteboards.
                </p>
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
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
