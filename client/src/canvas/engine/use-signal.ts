import { react, type Signal } from '@tldraw/state';
import { useCallback, useSyncExternalStore } from 'react';

/** React observes content/membership signals only. Transforms use react() directly. */
export function useSignalValue<T>(signal: Signal<T>): T {
  const subscribe = useCallback(
    (notify: () => void) => {
      let first = true;
      return react('React content subscription', () => {
        signal.get();
        if (!first) notify();
        first = false;
      });
    },
    [signal],
  );
  const read = useCallback(() => signal.get(), [signal]);
  return useSyncExternalStore(subscribe, read, read);
}
