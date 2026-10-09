// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';

it('replaces a crashed tree with a reload screen and reports the crash', async () => {
  const fetchSpy = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
  vi.stubGlobal('fetch', fetchSpy);
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Boom = (): never => {
    throw new Error('render exploded');
  };
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  await act(async () => {
    createRoot(host).render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
  });
  expect(host.textContent).toContain('Something went wrong.');
  expect(fetchSpy).toHaveBeenCalledWith('/api/client-errors', expect.anything());
  const body = JSON.parse((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
  expect(body.message).toBe('render exploded');
  expect(body.componentStack).toContain('Boom');
  vi.unstubAllGlobals();
});
