import { useEffect, useState } from 'react';

export function formatNumber(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '';
  return Number(value.toFixed(maxDecimals)).toString();
}

const MINUS = '−';

/**
 * A range bound as a mathematician would write it: a true minus sign,
 * multiples of π/4 as π, and as many decimals as the window's `span` needs
 * to tell its two ends apart (a window zoomed to 0.01 wide shows 4).
 */
export function formatBound(value: number, span = 10): string {
  if (!Number.isFinite(value)) return '';
  for (const d of [1, 2, 4]) {
    const n = Math.round((value * d) / Math.PI);
    // Loose enough for the 6.283 older boards saved, never looser than the
    // window, or both ends of a deep zoom near π/4 would read "π/4".
    const tolerance = Math.min(5e-4, span / 1000);
    if (n !== 0 && Math.abs(value - (n * Math.PI) / d) < tolerance) {
      const coef = Math.abs(n) === 1 ? '' : String(Math.abs(n));
      return `${n < 0 ? MINUS : ''}${coef}π${d > 1 ? `/${d}` : ''}`;
    }
  }
  const decimals = Math.min(6, Math.max(2, Math.ceil(-Math.log10(span)) + 2));
  return formatNumber(value, decimals).replace('-', MINUS);
}

/**
 * Reads what `formatBound` writes, and what people type: `−`, a decimal
 * comma, and `π`/`pi` with an optional coefficient and divisor (`-3pi/4`).
 * Empty is NaN, not 0, so a cleared field reverts instead of committing 0.
 */
export function parseBound(text: string): number {
  const s = text
    .trim()
    .replace(/−/g, '-')
    .replace(',', '.')
    .replace(/pi/gi, 'π')
    .replace(/[\s*]/g, '');
  const pi = /^([+-]?)(\d*\.?\d*)π(?:\/(\d*\.?\d+))?$/.exec(s);
  if (pi) {
    const coef = pi[2] === '' ? 1 : Number(pi[2]);
    return (pi[1] === '-' ? -1 : 1) * coef * (Math.PI / Number(pi[3] ?? 1));
  }
  return s === '' ? NaN : Number(s);
}

export function valueFromSlider(value: number | readonly number[]): number {
  return typeof value === 'number' ? value : value[0]!;
}

/** Trails `value` by `delay` ms — keeps parse errors quiet while typing. */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

