import { useId, useState, type FormEvent } from 'react';
import { login } from '@/board/auth';
import { BrandMark } from '@/components/brand-mark';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
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
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10 text-fg sm:px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <Card className="gap-6 py-6 shadow-e2">
          <CardHeader className="gap-5">
            <div className="flex items-center gap-2.5">
              <BrandMark className="size-7" />
              <span className="text-sm font-semibold text-fg">Whiteboard</span>
            </div>
            <div className="grid gap-1.5">
              <CardTitle>
                <h1 className="text-balance text-2xl font-semibold text-fg">
                  Tutor access
                </h1>
              </CardTitle>
              <CardDescription className="text-pretty text-base text-fg-secondary">
                Enter the tutor password to access the dashboard and manage
                canvases.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <FieldGroup>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel
                  htmlFor={passwordId}
                  className="text-sm font-medium text-fg-secondary"
                >
                  Password
                </FieldLabel>
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
          </CardContent>

          <CardFooter>
            <Button
              type="submit"
              variant="default"
              size="md"
              className="w-full text-sm"
              disabled={busy}
            >
              {busy ? 'Signing in…' : 'Sign In'}
            </Button>
          </CardFooter>
        </Card>
      </form>
    </main>
  );
}
