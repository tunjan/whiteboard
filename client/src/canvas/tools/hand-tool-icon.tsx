import { HandGlyph, HandGrabGlyph } from '@/components/ui/glyphs';
import { cn } from '@/lib/utils';
import { useCameraInteraction } from '../use-camera-interaction';

/** Open at rest, closed while dragging. Motion is limited to state feedback. */
export function HandToolIcon({ className }: { className?: string }) {
  const isDragging = useCameraInteraction((s) => s.isHandDragging);

  return (
    <span
      aria-hidden="true"
      className={cn(
        'relative block size-[18px] transition-transform duration-150 ease-out group-active/button:scale-[0.94] motion-reduce:transition-none',
        isDragging && 'scale-[0.92]',
        className,
      )}
    >
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
          isDragging ? 'scale-75 opacity-0' : 'scale-100 opacity-100',
        )}
      >
        <HandGlyph className="size-full" />
      </span>
      <span
        className={cn(
          'absolute inset-0 flex items-center justify-center transition-[transform,opacity] duration-150 ease-out motion-reduce:transition-none',
          isDragging ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        )}
      >
        <HandGrabGlyph className="size-full" />
      </span>
    </span>
  );
}
