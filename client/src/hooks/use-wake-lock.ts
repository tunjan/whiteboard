import { useEffect } from 'react';

/**
 * Keep the screen awake while a board is open.
 *
 * A tutoring board is watched far more than it is touched: a student following
 * a worked solution on an iPad touches nothing for minutes at a time, and the
 * display sleeping mid-explanation drops them out of the lesson and, on iPadOS,
 * suspends the collaboration socket with it.
 *
 * The lock is released by the OS whenever the tab is hidden, and cannot be
 * taken while it is, so it is re-acquired on every return to visibility rather
 * than held once at mount. Unsupported browsers (and a request the OS refuses,
 * on low battery) fall through silently — this improves a session, it does not
 * gate one.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !navigator.wakeLock) return;
    let sentinel: WakeLockSentinel | null = null;
    let released = false;

    const acquire = async () => {
      if (released || sentinel || document.visibilityState !== 'visible')
        return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        // The OS drops it on backgrounding; forget it so the next return to
        // visibility asks for a fresh one instead of believing it still holds.
        sentinel.addEventListener('release', () => {
          sentinel = null;
        });
        if (released) void sentinel.release().catch(() => {});
      } catch {
        sentinel = null;
      }
    };

    void acquire();
    const onVisibility = () => void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [enabled]);
}
