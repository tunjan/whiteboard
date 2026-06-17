import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function isLightColor(color: string, theme?: 'light' | 'dark'): boolean {
  if (!color) return false;
  const normalized = color.toLowerCase().trim();
  if (normalized.includes('var(--color-foreground)')) {
    return theme === 'dark'; // in dark theme, foreground is white/light
  }
  if (normalized === 'transparent' || normalized === 'none') {
    return theme !== 'dark'; // transparent is light in light theme, dark in dark theme
  }
  const hex = normalized.replace('#', '');
  if (hex.length === 3) {
    const rChar = hex[0] ?? '0';
    const gChar = hex[1] ?? '0';
    const bChar = hex[2] ?? '0';
    const r = parseInt(rChar + rChar, 16);
    const g = parseInt(gChar + gChar, 16);
    const b = parseInt(bChar + bChar, 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }
  if (hex.length === 6) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55;
  }
  return false;
}


