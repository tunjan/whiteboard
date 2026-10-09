import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Toolbar } from '@/components/toolbar';
import { Button } from '@/components/ui/button';
import { useThemeStore } from '@/use-theme-store';
import { useToolStore } from '@/canvas/use-tool-store';

useToolStore.setState({ activeToolId: 'draw' });

function App() {
  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);
  const [drawing, setDrawing] = useState(true);
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-canvas text-fg">
      <div className="absolute inset-x-6 top-5 z-10 flex flex-wrap items-center gap-3">
        <span className="text-sm text-fg-secondary">Toolbar preview</span>
        <Button variant="outline" size="sm" onClick={toggleTheme}>
          {theme === 'light' ? 'Dark appearance' : 'Light appearance'}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDrawing((value) => !value)}
        >
          {drawing ? 'Hide drawing' : 'Show drawing'}
        </Button>
        <div className="flex items-center gap-1 border-s border-border ps-3">
          {(['draw', 'rectangle', 'eraser', 'text', 'arrow'] as const).map((t) => (
            <Button
              key={t}
              variant={activeToolId === t ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setTool(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      </div>
      <svg
        className="pointer-events-none absolute inset-0 size-full"
        aria-hidden="true"
      >
        <defs>
          <pattern
            id="preview-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M40 0H0V40"
              fill="none"
              stroke="currentColor"
              strokeOpacity=".07"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#preview-grid)" />
      </svg>
      {drawing && (
        <svg
          className="pointer-events-none absolute bottom-0 h-64 w-full"
          viewBox="0 0 1280 256"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M80 256C220 240 235 80 430 105S720 245 820 225S960 115 1200 160"
            fill="none"
            stroke="#5b9bf3"
            strokeWidth="70"
            opacity=".55"
          />
          <path
            d="M210 190C400 140 490 270 690 165S1000 90 1120 256"
            fill="none"
            stroke="#52bb91"
            strokeWidth="34"
            opacity=".5"
          />
          {/* Saturated, high-contrast marks directly under the bar. The plate
              is opaque, so nothing here shows through it — what this checks is
              that the bar reads as a separate object over busy content rather
              than merging into it. */}
          <path
            d="M300 120C420 60 520 230 640 150S880 40 1040 130"
            fill="none"
            stroke="#f0483f"
            strokeWidth="26"
            opacity=".62"
          />
          <path
            d="M120 60C280 20 420 150 560 60S900 -10 1160 70"
            fill="none"
            stroke="#f5b700"
            strokeWidth="44"
            opacity=".5"
          />
          <rect
            x="560"
            y="40"
            width="240"
            height="216"
            fill="#1a1a1e"
            opacity=".82"
          />
          <rect
            x="860"
            y="90"
            width="150"
            height="166"
            fill="#6b3df5"
            opacity=".7"
          />
          <path
            d="M130 230C290 170 360 210 415 180S620 170 710 219S990 195 1190 215"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            opacity=".32"
          />
        </svg>
      )}
      <Toolbar />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
