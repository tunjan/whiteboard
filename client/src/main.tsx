import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root element #root not found');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// TEMPORARY perf harness — delete with client/src/canvas/zoom-bench.ts.
// The param is read now, not in the timeout: the board route rewrites the
// query string as it mounts, and by then the flag is gone.
if (import.meta.env.DEV) {
  const params = new URLSearchParams(location.search);
  const n = Number(params.get('zoombench'));
  if (n > 0) {
    setTimeout(() => {
      void import('./canvas/zoom-bench').then((m) => m.runZoomBench(n));
    }, 2500);
  }
  const seed = Number(params.get('zoomseed'));
  if (seed > 0) {
    setTimeout(() => {
      void import('./canvas/zoom-bench').then((m) => m.seedOnly(seed));
    }, 2500);
  }
}
