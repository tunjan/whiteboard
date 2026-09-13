import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Toolbar } from '@/components/toolbar';
import { useToolStore } from '@/canvas/use-tool-store';

/**
 * The style controls over content, which is the only way to look at glass.
 *
 * A flat canvas tells you nothing about this material: the tint is almost
 * nothing and the lens ring has nothing to bend, so a capsule on an empty board
 * is just a pale pill. What has to be checked is the bar standing over ink —
 * saturated strokes, a hard edge crossing under a capsule, and a dense patch
 * where the rim has to stay readable — in both themes.
 */
function Ink() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full"
      viewBox="0 0 900 420"
      preserveAspectRatio="none"
    >
      <rect x={0} y={250} width={900} height={70} fill="#4465e9" />
      <rect x={0} y={320} width={900} height={40} fill="#e16919" />
      <circle cx={210} cy={330} r={86} fill="#099268" />
      <circle cx={470} cy={300} r={54} fill="#e03131" />
      <path
        d="M40 390 Q220 250 420 370 T880 300"
        fill="none"
        stroke="#ae3ec9"
        strokeWidth={22}
        strokeLinecap="round"
      />
      {Array.from({ length: 26 }, (_, i) => (
        <line
          key={i}
          x1={620 + i * 10}
          y1={248}
          x2={560 + i * 10}
          y2={418}
          stroke="#1d1d1d"
          strokeWidth={3}
        />
      ))}
      <text x={30} y={300} fontSize={34} fontWeight={700} fill="#1d1d1d">
        legibility test
      </text>
    </svg>
  );
}

function App() {
  const [dark, setDark] = useState(false);
  const [busy, setBusy] = useState(true);
  const [simplified, setSimplified] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains('dark');
    const wasSimplified = root.hasAttribute('data-low-graphics');
    root.classList.toggle('dark', dark);
    root.toggleAttribute('data-low-graphics', simplified);
    return () => {
      root.classList.toggle('dark', wasDark);
      root.toggleAttribute('data-low-graphics', wasSimplified);
    };
  }, [dark, simplified]);

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas text-fg">
      <div className="relative z-10 flex flex-wrap items-center gap-4 p-5 text-sm">
        <span className="font-medium">Liquid Glass · Toolbar</span>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
          />
          Dark
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={busy}
            onChange={(event) => setBusy(event.target.checked)}
          />
          Ink behind toolbar
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={simplified}
            onChange={(event) => setSimplified(event.target.checked)}
          />
          Simplified glass
        </label>
      </div>
      {busy && <Ink />}
      <Toolbar />
    </div>
  );
}

useToolStore.getState().setTool('draw');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
