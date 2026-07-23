import type { SVGProps } from 'react';

/** Lucide-style laser pointer: 24px grid, 2px stroke, round caps and joins. */
export function LaserToolIcon({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="m13 9 3 3-7.5 7.5a2.12 2.12 0 0 1-3-3Z" />
      <path d="m10 14 3 3" />
      <path d="m16.5 8.5 2-2" />
      <circle cx="21" cy="4" r="1" />
    </svg>
  );
}
