import { shapeStore } from '@/canvas/engine/shape-store';
import { useStoreValue } from '@/canvas/use-shapes';
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
      <span className="text-fg-secondary">{label}</span>
      <span className="tabular-nums text-fg">{value}</span>
    </div>
  );
}

export function PerformanceOverlay() {
  const { fps, frameMs } = useFrameStats();
  const shapeCount = useStoreValue(() => shapeStore.sorted.get().length, []);
  const memory = (performance as Performance & { memory?: PerformanceMemory })
    .memory;

  return (
    <div
      data-ui-layer
      // Tucked under the top-left board chrome rather than beside it. The
      // canvas HUD band sits *below* the UI layer that the chrome panels live
      // in (see the z-index scales in index.css), so anything this readout
      // shares a corner with paints straight over it — at `top-3 left-3` it
      // was completely hidden behind the board navigation panel.
      //
      // The offsets are the chrome's own height: 44px for the docked panel
      // (32px control + its padding), 56px once coarse pointers grow those
      // controls to 44px targets, plus a hairline gap. Same numbers the
      // presence cluster uses to clear the panel on narrow screens. Left edge
      // lines up with the back button above it.
      className="pointer-events-none absolute top-[calc(3.25rem+env(safe-area-inset-top))] left-[calc(0.5rem+env(safe-area-inset-left))] z-[var(--z-canvas-hud)] flex min-w-40 flex-col gap-1 rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs shadow-hover [@media(pointer:coarse)]:top-[calc(4rem+env(safe-area-inset-top))]"
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
