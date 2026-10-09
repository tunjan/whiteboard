import { decodeEphemeral, EPHEMERAL_PREFIX } from '@whiteboard/shared';

const RATE_WINDOW_MS = 10_000;
/** Laser (25/s) and eraser trail (~17/s) together stay well under this. */
const MAX_MESSAGES_PER_WINDOW = 1_000;

export interface EphemeralConnection {
  sendStateless: (payload: string) => void;
}

export interface EphemeralDocument<Connection extends EphemeralConnection> {
  getClients: (connection: Connection) => Set<unknown>;
  getConnections: () => Connection[];
}

export type EphemeralRelayResult = 'ignored' | 'rejected' | 'relayed';

interface RateWindow {
  startedAt: number;
  count: number;
}

/**
 * Fan a laser or eraser-trail message out to everyone else on the board. The
 * sender must own the awareness client id it names, so a peer's strokes cannot
 * be drawn or cleared by someone else.
 */
export function createEphemeralRelay() {
  const rateWindows = new WeakMap<object, RateWindow>();

  return function relayEphemeral<Connection extends EphemeralConnection>({
    connection,
    document,
    payload,
    now = Date.now(),
  }: {
    connection: Connection;
    document: EphemeralDocument<Connection>;
    payload: string;
    now?: number;
  }): EphemeralRelayResult {
    if (!payload.startsWith(EPHEMERAL_PREFIX)) return 'ignored';

    const current = rateWindows.get(connection);
    const window =
      !current || now - current.startedAt >= RATE_WINDOW_MS
        ? { startedAt: now, count: 0 }
        : current;
    window.count += 1;
    rateWindows.set(connection, window);
    if (window.count > MAX_MESSAGES_PER_WINDOW) return 'rejected';

    const message = decodeEphemeral(payload);
    if (!message || !document.getClients(connection).has(message.from)) {
      return 'rejected';
    }

    for (const candidate of document.getConnections()) {
      if (candidate !== connection) candidate.sendStateless(payload);
    }
    return 'relayed';
  };
}
