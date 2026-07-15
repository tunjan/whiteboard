import { Hand, HandGrab } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCameraInteraction } from '../use-camera-interaction';

/** Open at rest, closed while dragging. Motion is limited to state feedback. */
export function HandToolIcon({ className }: { className?: string }) {
  const isDragging = useCameraInteraction((s) => s.isHandDragging);

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block size-4 transition-transform duration-150 ease-out group-active/button:scale-[0.94] motion-reduce:transition-none',
        isDragging && 'scale-[0.92]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
          isDragging ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
        )}
      >
        <Hand />
      </span>
      <span
        className={cn(
          'absolute inset-0 transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
          isDragging ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
      >
        <HandGrab />
      </span>
    </span>
  );
}
