import { useConnectionStore } from '@/collab/use-connection-store';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { Cloud, CloudOff, Loader2 } from 'lucide-react';

const STATUS = {
  connected: {
    label: 'Connected',
    Icon: Cloud,
    colorClass: 'text-[var(--content-success)]',
  },
  connecting: {
    label: 'Connecting',
    Icon: Loader2,
    colorClass: 'text-[var(--content-attention)] animate-spin',
  },
  disconnected: {
    label: 'Disconnected',
    Icon: CloudOff,
    colorClass: 'text-[var(--content-error)]',
  },
} as const;

/** Connection status pill for the top bar. */
export function ConnectionIndicator() {
  const status = useConnectionStore((s) => s.status);
  const info = STATUS[status];
  const Icon = info.Icon;
  return (
    <TooltipProvider delay={300}>
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              aria-label={info.label}
              aria-live="polite"
              className="flex size-5 items-center justify-center text-xs select-none focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-border-subtle"
              role="status"
              tabIndex={0}
              title={info.label}
            />
          }
        >
          <Icon className={`size-4 ${info.colorClass}`} />
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <span>{info.label}</span>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
