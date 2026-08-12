import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * tailwind-merge only knows Tailwind's stock scales, so it treats
 * `rounded-panel` (our 16 px chrome radius, `--radius-panel`) as an unknown
 * class and keeps it alongside a later `rounded-none`. Tailwind emits
 * `.rounded-none` *before* `.rounded-panel`, so the base class then wins and
 * the override silently does nothing — which is how docked chrome panels ended
 * up with four rounded corners instead of one. Teaching the merger about the
 * custom value makes `rounded-none` and `rounded-<corner>-panel` override it.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["panel"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Darkened border for a color swatch, so a light swatch still reads against a light panel. */
export function swatchBorder(color: string) {
  return `color-mix(in srgb, ${color} 75%, #000)`
}
