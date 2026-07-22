import type { SVGProps } from 'react';

/**
 * Lucide-style laser pointer for the presentation laser tool.
 * 24×24, stroke 2, round caps/joins, currentColor — matches lucide-react icons.
 */
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
      {/* Laser pen body (angled capsule outline) */}
      <path d="M13 11 5.5 18.5c-1 1-1 2.5 0 3.4l.6.6c1 1 2.5 1 3.4 0L17 15" />
      {/* Grip band */}
      <path d="m9 15 3 3" />
      {/* Beam */}
      <path d="M15 9 19 5" />
      {/* Laser spot */}
      <circle cx="21" cy="3" r="1" />
    </svg>
  );
}
