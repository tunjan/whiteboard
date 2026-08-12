import { Toast } from '@base-ui/react/toast';
import { TriangleAlert, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { nextHighLatencyEpisode } from '@/collab/high-latency';
import { useConnectionStore } from '@/collab/use-connection-store';
import { Button } from '@/components/ui/button';

const TOAST_TIMEOUT_MS = 5_000;

function LatencyWarningController() {
  const latencyMs = useConnectionStore((state) => state.latencyMs);
  const episodeActive = useRef(false);
  const toastManager = Toast.useToastManager();

  useEffect(() => {
    const transition = nextHighLatencyEpisode(
      episodeActive.current,
      latencyMs,
    );
    episodeActive.current = transition.active;

    if (!transition.shouldNotify || latencyMs === null) return;

    toastManager.add({
      id: 'high-latency-warning',
      title: 'Slow connection',
      description: `Your connection latency is ${latencyMs.toLocaleString()} ms. Changes may take longer to appear.`,
      priority: 'low',
      timeout: TOAST_TIMEOUT_MS,
      type: 'warning',
    });
  }, [latencyMs, toastManager]);

  return null;
}

function LatencyWarningList() {
  const { close, toasts } = Toast.useToastManager();

  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      className="pointer-events-auto w-full rounded-md bg-warning-bg text-primary border border-warning-border shadow-md transition-all duration-200 ease-out data-ending-style:-translate-y-1 data-ending-style:opacity-0 data-starting-style:-translate-y-2 data-starting-style:opacity-0"
    >
      <Toast.Content className="flex items-start gap-3 p-3.5">
        <span
          aria-hidden="true"
          className="flex size-7 shrink-0 items-center justify-center rounded-xs bg-warning/10 text-warning"
        >
          <TriangleAlert className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
          <Toast.Title className="text-xs font-semibold text-warning" />
          <Toast.Description className="text-xs text-secondary leading-relaxed" />
        </div>
        <Toast.Action
          onClick={() => close(toast.id)}
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Dismiss slow connection warning"
              className="-mt-1 -mr-1 text-secondary hover:text-primary"
            />
          }
        >
          <X className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Dismiss slow connection warning</span>
        </Toast.Action>
      </Toast.Content>
    </Toast.Root>
  ));
}

/** Warn the current user once for each episode of latency above one second. */
export function LatencyWarningToast() {
  return (
    <Toast.Provider limit={1} timeout={TOAST_TIMEOUT_MS}>
      <LatencyWarningController />
      <Toast.Portal>
        <Toast.Viewport className="pointer-events-none fixed top-[calc(5.5rem+env(safe-area-inset-top))] left-[max(1rem,env(safe-area-inset-left))] z-50 w-[min(22.5rem,calc(100vw-2rem))] outline-none sm:top-[calc(3.5rem+env(safe-area-inset-top))]">
          <LatencyWarningList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}
