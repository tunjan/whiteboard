import { cn } from '@/lib/utils';

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 32 32"
      className={cn('size-9 text-foreground', className)}
    >
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="8"
        fill="var(--background)"
        stroke="var(--border)"
      />
      <path
        d="M5.5 25 C 8 22.5, 10.5 27, 15.5 23.5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.88"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <g transform="rotate(33 15.5 23.5)">
        <rect x="12.4" y="6" width="6.2" height="10" rx="2.4" fill="currentColor" />
        <rect x="11.8" y="15.2" width="7.4" height="1.9" rx="0.7" fill="currentColor" />
        <path d="M12.6 17.1 H18.4 L15.5 23.5 Z" fill="currentColor" fillOpacity="0.82" />
      </g>
    </svg>
  );
}
