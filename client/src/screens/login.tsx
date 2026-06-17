import { useState, type FormEvent } from 'react';
import { Shapes } from 'lucide-react';
import { login } from '@/board/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** Tutor sign-in. Gates the board-management home screen. */
export function Login({ onSuccess }: { onSuccess: () => void }) {
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
    <div className="grid min-h-screen place-items-center bg-background px-4 text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-xs rounded-xl border border-border bg-card p-6 shadow-sm"
      >
        <div className="mb-5 flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <Shapes className="size-4" />
          </div>
          <h1 className="text-base font-semibold tracking-tight">
            Tutor sign in
          </h1>
        </div>
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          autoComplete="current-password"
        />
        {error ? (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        ) : null}
        <Button type="submit" className="mt-4 w-full" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </div>
  );
}
