import { useDocumentStore } from '@/canvas/use-document-store';
import { useEffect, useState } from 'react';

// Chrome-only heap stats; absent elsewhere, in which case we hide the row.
interface PerformanceMemory {
  usedJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface FrameStats {
  fps: number;
  frameMs: number;
}

// Samples requestAnimationFrame to derive a smoothed FPS and worst frame time,
// refreshing the readout twice a second so the numbers stay legible.
function useFrameStats(): FrameStats {
  const [stats, setStats] = useState<FrameStats>({ fps: 0, frameMs: 0 });

  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let worstDelta = 0;
    let last = performance.now();
    let windowStart = last;

    const tick = (now: number) => {
      const delta = now - last;
      last = now;
      frames += 1;
      if (delta > worstDelta) worstDelta = delta;

      const elapsed = now - windowStart;
      if (elapsed >= 500) {
        setStats({
          fps: Math.round((frames * 1000) / elapsed),
          frameMs: Math.round(worstDelta * 10) / 10,
        });
        frames = 0;
        worstDelta = 0;
        windowStart = now;
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return stats;
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-secondary">{label}</span>
      <span className="tabular-nums text-primary">{value}</span>
    </div>
  );
}

export function PerformanceOverlay() {
  const { fps, frameMs } = useFrameStats();
  const shapeCount = useDocumentStore((s) => s.shapes.length);
  const memory = (performance as Performance & { memory?: PerformanceMemory })
    .memory;

  return (
    <div
      data-ui-layer
      className="pointer-events-none absolute top-3 left-3 z-20 flex min-w-40 flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs shadow-hover"
    >
      <StatRow label="FPS" value={String(fps)} />
      <StatRow label="Frame" value={`${frameMs.toFixed(1)} ms`} />
      <StatRow label="Shapes" value={String(shapeCount)} />
      {memory && (
        <StatRow
          label="Heap"
          value={`${Math.round(memory.usedJSHeapSize / 1048576)} MB`}
        />
      )}
    </div>
  );
}
