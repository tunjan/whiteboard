import type { ConnectionStatus } from '@/collab/use-connection-store';
import { useConnectionStore } from '@/collab/use-connection-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Bar count carries the quality; colour is held back until the connection
 * actually needs attention. A healthy link is the normal case and reads as
 * neutral ink, so a coloured indicator anywhere in the chrome always means
 * something is wrong rather than "still fine, still fine, still fine".
 *
 * Severity is still double-encoded for anyone who can't separate the hues:
 * dot and two arcs vs the dot alone says the same thing as grey vs red.
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
      activeBars: 3,
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
  // A dot with two concentric arcs spreading upward from it (dot = 1, each arc
  // adds one); unlit parts stay as faint ghosts so the scale is readable.
  const on = (i: number) => (i < activeBars ? 1 : 0.25);
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={4}
      strokeLinecap="round"
      className={cn('size-4', pending && 'animate-pulse', className)}
    >
      <circle cx={12} cy={18} r={2.75} fill="currentColor" stroke="none" opacity={on(0)} />
      <path d="M7.05 13.05a7 7 0 0 1 9.9 0" opacity={on(1)} />
      <path d="M3.161 9.161a12.5 12.5 0 0 1 17.678 0" opacity={on(2)} />
    </svg>
  );
}

/** Live collaboration quality shown as latency-sensitive signal bars. */
export function ConnectionIndicator() {
  const status = useConnectionStore((state) => state.status);
  const latencyMs = useConnectionStore((state) => state.latencyMs);
  const quality = connectionQuality(status, latencyMs);
  // With no link there are no bars to draw, and zero bars is a glyph too faint
  // to find. Those two states say what they are in words instead.
  const word =
    status === 'disconnected'
      ? 'Offline'
      : status === 'connecting'
        ? 'Connecting…'
        : null;
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
                'flex h-8 min-w-8 items-center justify-center rounded-md select-none hover:bg-[var(--chrome-hover,var(--color-panel))]',
                word && 'px-2',
              )}
              role="status"
              tabIndex={-1}
            />
          }
        >
          {word ? (
            <span className={cn('text-xs font-medium', quality.colorClass)}>
              {word}
            </span>
          ) : (
            <SignalBars
              activeBars={quality.activeBars}
              className={quality.colorClass}
              pending={quality.pending}
            />
          )}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="tabular-nums">
          {tooltipLabel}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
