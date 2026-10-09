// TEMPORARY review harness for BoardLoadingVeil. Delete with veil-review.html.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import type { BoardLoadStage } from '@/board/board-readiness';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { BoardLoadingVeil } from '@/components/board-loading-veil';
import './index.css';

const STAGES: BoardLoadStage[] = ['local', 'remote', 'page', 'ready'];

function set(stage: BoardLoadStage) {
  useBoardLoadingStore.setState({ stage, ready: stage === 'ready' });
}

function App() {
  const stage = useBoardLoadingStore((s) => s.stage);
  return (
    <div className="min-h-screen bg-panel p-6 font-sans">
      <div className="mb-4 flex gap-2">
        {STAGES.map((s) => (
          <button
            key={s}
            onClick={() => set(s)}
            className={`rounded-md border border-border px-3 py-1.5 text-sm ${s === stage ? 'bg-inverse text-fg-inverse' : 'bg-surface text-fg'}`}
          >
            {s}
          </button>
        ))}
        <button
          onClick={() => document.documentElement.classList.toggle('dark')}
          className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-fg"
        >
          theme
        </button>
      </div>
      <div className="relative h-[620px] w-full overflow-hidden rounded-xl border border-border bg-canvas">
        <BoardLoadingVeil title="Integration by parts" />
      </div>
    </div>
  );
}

useBoardLoadingStore.setState({ stage: 'remote', ready: false });
createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
);
