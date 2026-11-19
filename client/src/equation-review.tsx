import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import type { EquationShape } from '@whiteboard/shared';
import { EquationPanelContent } from '@/components/equation-panel';
import { ensureEquationRenderer, typesetEquation } from '@/canvas/equation-render';
import { useThemeStore } from '@/use-theme-store';
import { ALL_FEATURES } from '@whiteboard/shared';
import { useFeaturesStore } from '@/board/features';

// Review page: every feature on, AI included, without a server to ask.
useFeaturesStore.setState({ features: ALL_FEATURES });

function shape(id: string, latex: string, extra: Partial<EquationShape['props']> = {}): EquationShape {
  return {
    id, type: 'equation', x: 0, y: 0, rotation: 0, index: 'a1',
    props: { latex, w: 200, h: 80, fontSize: 22, color: '#1d1d1d', inline: false, ...extra },
  } as EquationShape;
}

function Pane({ label, dark, children }: { label: string; dark?: boolean; children: React.ReactNode }) {
  return (
    <div className={dark ? 'dark' : ''}>
      <div className="bg-canvas p-4">
        <div className="mb-2 text-2xs text-fg-muted">{label}</div>
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}

useThemeStore.setState({ theme: 'light' });
setTimeout(() => document.documentElement.classList.remove('dark'), 0);
void ensureEquationRenderer().then(() =>
  Promise.all([
    typesetEquation(String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`, false),
    typesetEquation(String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}`, true),
  ]),
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
      <Pane label="light — ok">
        <EquationPanelContent shape={shape('a', String.raw`\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}`)} />
      </Pane>
      <Pane label="light — unbalanced brace">
        <EquationPanelContent shape={shape('b', String.raw`\frac{a}{b`)} />
      </Pane>
      <Pane label="light — empty">
        <EquationPanelContent shape={shape('c', '')} />
      </Pane>
      <Pane label="dark — ok" dark>
        <EquationPanelContent shape={shape('d', String.raw`\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}`, { color: '#f3f3f3', inline: true, fontSize: 28 })} />
      </Pane>
    </div>
  </StrictMode>,
);
