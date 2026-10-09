const reported = new Set<string>();

/**
 * Send an error to the server log (`/api/client-errors`). Each distinct message
 * goes once per page load: a render loop throwing every frame is one report,
 * not a flood.
 */
export function reportClientError(error: unknown, componentStack?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  if (reported.has(err.message) || reported.size >= 20) return;
  reported.add(err.message);
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // Survives the page being reloaded out from under it, which is the
    // fallback's only button.
    keepalive: true,
    body: JSON.stringify({
      message: err.message,
      stack: err.stack,
      componentStack,
      url: location.href,
    }),
  }).catch(() => {});
}
