import { useEffect, useState } from 'react';

export function formatNumber(value: number, maxDecimals = 2): string {
  if (!Number.isFinite(value)) return '';
  return Number(value.toFixed(maxDecimals)).toString();
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

