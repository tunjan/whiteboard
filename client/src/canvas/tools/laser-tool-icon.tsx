import type { SVGProps } from 'react';

/**
 * Laser pointer drawn on Lucide's 24px grid: 2px stroke, round caps and joins,
 * content inside the 2–22 safe area. The barrel is a 45° tube with a rounded
 * butt and a flat muzzle, so it reads as an emitter rather than a pen nib; the
 * detached beam segment and dot carry the "laser" meaning.
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
      <path d="M8.5 11.5 3 17a2.83 2.83 0 0 0 4 4l5.5-5.5Z" />
      <path d="m13 11 2.5-2.5" />
      <circle cx="18.5" cy="5.5" r="1" />
    </svg>
  );
}
