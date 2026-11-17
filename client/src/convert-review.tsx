// TEMPORARY review harness for the handwriting -> equation conversion. Delete.
import { createRoot } from 'react-dom/client';
import './index.css';

const realFetch = window.fetch.bind(window);
(window as any).__ai = { delay: 3000, calls: 0, fail: false };
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : String((input as Request).url ?? input);
  const json = (b: unknown) => new Response(JSON.stringify(b), { headers: { 'content-type': 'application/json' } });
  if (url.includes('/api/ai/config')) return Promise.resolve(json({ enabled: true }));
  if (url.includes('/api/ai/latex/ink')) {
    const ai = (window as any).__ai;
    ai.calls++;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve(ai.fail ? new Response('{}', { status: 422 }) : json({ latex: String.raw`x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}` })), ai.delay);
      init?.signal?.addEventListener('abort', () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); });
    });
  }
  return realFetch(input as RequestInfo, init);
}) as typeof window.fetch;

const [{ Canvas }, { loadBoard, editor }, { useCameraStore }, { EquationPanel }, { Toaster }] = await Promise.all([
  import('./canvas/Canvas'),
  import('./canvas/use-document-store'),
  import('./canvas/use-camera-store'),
  import('./components/equation-panel'),
  import('./components/ui/toast'),
]);
await import('./canvas/shapes/register');
loadBoard('convert-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: -300, y: -150, z: 1 }, activeKey: '' });
Object.assign(window, { editor });
createRoot(document.getElementById('root')!).render(
  <>
    <Canvas />
    <EquationPanel />
    <Toaster />
  </>,
);
