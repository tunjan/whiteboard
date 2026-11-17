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
 *
 * Same story for the elevation aliases: `Surface`'s `mode="docked"` variant
 * sets `shadow-none`, and a caller overriding it with `shadow-e2`/`shadow-e3`
 * etc. silently lost — `.shadow-none` happened to land later in the compiled
 * sheet, so it won regardless of class order. Teaching the merger these
 * custom shadow keys lets the later class win instead.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["panel", "control"],
      shadow: ["e0", "e1", "e2", "e3", "e4", "e5", "control", "panel", "overlay", "hover", "floating"],
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

/**
 * A file name that fits one line, cut from the middle: the end of a name is
 * where its version and extension live, and those are what tell two files apart.
 */
export function shortFileName(name: string, max = 32) {
  if (name.length <= max) return name
  const tail = Math.min(name.length - name.lastIndexOf('.') + 4, 12)
  return `${name.slice(0, max - tail - 1)}…${name.slice(-tail)}`
}
