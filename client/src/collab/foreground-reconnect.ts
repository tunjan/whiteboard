import type { HocuspocusProviderWebsocket } from '@hocuspocus/provider';

/**
 * Reconnect the board socket the moment the tab comes back to the foreground.
 *
 * iPadOS suspends a backgrounded tab's timers and its socket without telling
 * the page: switching apps, locking the screen, or dragging the app out of
 * Split View all end with a connection that is either closed or half-open, and
 * nothing running to notice. Hocuspocus does notice — but on its own schedule,
 * and by then the reconnect is on an exponential backoff that can be tens of
 * seconds long. A student who unlocks their iPad should not watch a dead board
 * for that long.
 *
 * Both cases are handled by the provider's own machinery, just earlier than it
 * would reach them: `connect()` cancels a pending retry and attempts straight
 * away (and no-ops if already connected), while `checkConnection()` is what
 * force-closes a socket that still claims to be connected but has heard
 * nothing — the half-open case, which is the common one after a suspend.
 */
export function startForegroundReconnect(
  socket: HocuspocusProviderWebsocket,
): () => void {
  const wake = () => {
    if (document.visibilityState !== 'visible') return;
    if (!socket.shouldConnect) return; // deliberately disconnected; leave it
    socket.checkConnection();
    void socket.connect().catch(() => {});
  };

  document.addEventListener('visibilitychange', wake);
  // `pageshow` covers the back/forward cache, which iOS Safari restores from
  // without ever firing `visibilitychange`.
  window.addEventListener('pageshow', wake);
  window.addEventListener('online', wake);

  return () => {
    document.removeEventListener('visibilitychange', wake);
    window.removeEventListener('pageshow', wake);
    window.removeEventListener('online', wake);
  };
}
