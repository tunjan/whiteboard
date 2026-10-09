import { Component, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { reportClientError } from '@/report-error';

/**
 * The last line under a render crash: a way back instead of a blank page, and
 * a report to the server so the crash is heard about at all. The board itself
 * is already synced, so reloading loses nothing but the moment.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean }
> {
  override state = { crashed: false };

  static getDerivedStateFromError() {
    return { crashed: true };
  }

  override componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    reportClientError(error, info.componentStack ?? undefined);
  }

  override render() {
    if (!this.state.crashed) return this.props.children;
    return (
      <div
        role="alert"
        className="flex h-dvh flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <p className="text-sm text-muted-foreground">Something went wrong.</p>
        <Button onClick={() => location.reload()}>Reload</Button>
      </div>
    );
  }
}
