import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Slider } from '@/components/ui/slider';
import { OpacitySlider } from '@/components/opacity-slider';

function App() {
  return (
    <div style={{ padding: 24, width: 420, fontFamily: 'system-ui', background: 'var(--bg-surface)' }}>
      <div style={{ fontSize: 11, opacity: 0.5, marginBottom: 6 }}>shared Slider · 0.6</div>
      <Slider min={0} max={1} step={0.01} value={0.6} />
      <div style={{ fontSize: 11, opacity: 0.5, margin: '22px 0 6px' }}>opacity fader · 0.6</div>
      <OpacitySlider aria-label="Opacity" value={0.6} onValueChange={() => {}} />
      <div style={{ fontSize: 11, opacity: 0.5, margin: '22px 0 6px' }}>opacity fader in panel width</div>
      <div style={{ width: 168 }}>
        <OpacitySlider aria-label="Opacity" value={0.35} onValueChange={() => {}} />
      </div>
    </div>
  );
}

if (new URLSearchParams(location.search).has('dark')) {
  document.documentElement.classList.add('dark');
  document.body.style.background = 'var(--bg-panel)';
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
