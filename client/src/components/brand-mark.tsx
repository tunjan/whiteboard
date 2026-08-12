import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <img
      src="/best-whiteboard-brandmark.png"
      alt=""
      aria-hidden="true"
      className={cn('size-9 rounded-full', className)}
    />
  );
}
