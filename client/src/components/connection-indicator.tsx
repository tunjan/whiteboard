import type { ConnectionStatus } from '@/collab/use-connection-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const BARS = [
  { x: 1, y: 11, height: 4 },
  { x: 5, y: 8, height: 7 },
  { x: 9, y: 5, height: 10 },
  { x: 13, y: 2, height: 13 },
] as const;

/**
 * Bar count carries the quality; colour is held back until the connection
 * actually needs attention. A healthy link is the normal case and reads as
 * neutral ink, so a coloured indicator anywhere in the chrome always means
 * something is wrong rather than "still fine, still fine, still fine".
 *
 * Severity is still double-encoded for anyone who can't separate the hues:
 * four bars vs one says the same thing as grey vs red.
 */
function connectionQuality(
  status: ConnectionStatus,
  latencyMs: number | null,
) {
  if (status === 'disconnected') {
    return {
      activeBars: 0,
      label: 'Disconnected',
      colorClass: 'text-danger',
      pending: false,
    };
  }
  if (status === 'connecting' || latencyMs === null) {
    return {
      activeBars: 0,
      label: status === 'connecting' ? 'Connecting' : 'Measuring connection',
      colorClass: 'text-fg-subtle',
      pending: true,
    };
  }
  if (latencyMs <= 100) {
    return {
      activeBars: 4,
      label: 'Excellent connection',
      colorClass: 'text-fg-muted',
      pending: false,
    };
  }
  if (latencyMs <= 200) {
    return {
      activeBars: 3,
      label: 'Good connection',
      colorClass: 'text-fg-muted',
      pending: false,
    };
  }
  if (latencyMs <= 400) {
    return {
      activeBars: 2,
      label: 'Fair connection',
      colorClass: 'text-warning',
      pending: false,
    };
  }
  return {
    activeBars: 1,
    label: 'Poor connection',
    colorClass: 'text-danger',
    pending: false,
  };
}

function SignalBars({
  activeBars,
  className,
  pending,
}: {
  activeBars: number;
  className?: string;
  pending: boolean;
}) {
  return (
    <svg
      aria-hidden="true"
      className={cn('size-4', pending && 'animate-pulse', className)}
      viewBox="0 0 17 16"
    >
      {BARS.map((bar, index) => (
        <rect
          key={bar.x}
          className={cn(
            'transition-opacity duration-200 motion-reduce:transition-none',
            index < activeBars ? 'opacity-100' : 'opacity-20',
          )}
          fill="currentColor"
          height={bar.height}
          rx="1"
          width="3.5"
          x={bar.x}
          y={bar.y}
        />
      ))}
    </svg>
  );
}

/** Live collaboration quality shown as latency-sensitive signal bars. */
export function ConnectionIndicator() {
  const status = useConnectionStore((state) => state.status);
  const latencyMs = useConnectionStore((state) => state.latencyMs);
  const quality = connectionQuality(status, latencyMs);
  const tooltipLabel =
    latencyMs !== null
      ? `${latencyMs} ms`
      : status === 'connected'
        ? 'Measuring latency…'
        : quality.label;
  const accessibleLabel =
    latencyMs === null
      ? quality.label
      : `${quality.label}, ${latencyMs} ms latency`;

  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              aria-label={accessibleLabel}
              data-toolbar-item
              className={cn(
                'flex size-8 items-center justify-center rounded-md select-none hover:bg-[var(--chrome-hover,var(--color-panel))]',
              )}
              role="status"
              tabIndex={-1}
            />
          }
        >
          <SignalBars
            activeBars={quality.activeBars}
            className={quality.colorClass}
            pending={quality.pending}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="tabular-nums">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
