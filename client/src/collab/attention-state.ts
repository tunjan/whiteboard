/**
 * Timing for the tutor's view of a student's attention.
 *
 * Peers publish facts, not durations: an activity counter and whether their tab
 * is frontmost. Everything here runs on the *reader's* clock, timing when those
 * values changed rather than trusting a timestamp from another machine. That
 * sidesteps clock skew, and it survives the browser freezing a hidden tab's
 * timers — the one edge that matters is published before the freeze, and the
 * reader keeps counting from there.
 */

export type AttentionState = 'attentive' | 'idle' | 'away';

/** Why a peer's board is not the thing in front of them. */
export type AwayReason = 'hidden' | 'unfocused';

/** The awareness payload a client publishes about itself. */
export interface AttentionPresence {
  /** Bumped on local input, at most once a second. Readers time the gaps. */
  activity: number;
  /** Why this client is not frontmost, or null when it is. */
  away: AwayReason | null;
}

export interface AttentionThresholds {
  /** Seconds without input before a present peer counts as idle. */
  idleSeconds: number;
  /** Seconds in another window before a peer counts as away. */
  awaySeconds: number;
}

export interface PeerAttention {
  state: AttentionState;
  /**
   * When the *condition* behind the state began — the last input for `idle`,
   * the switch away for `away` — not when it crossed the threshold. This is
   * what "idle for 4 minutes" should count from.
   */
  sinceMs: number;
  /** Last counter value seen, to detect the next bump. */
  activity: number;
  /** Local time of the last counter bump. */
  activeAtMs: number;
  away: AwayReason | null;
  /** Local time this peer went away, or null while it is frontmost. */
  awayAtMs: number | null;
}

/**
 * Fold one sample into a peer's attention. `sample` is null for a peer that
 * publishes no attention field — an older client, or one whose first sample has
 * not landed — and those are never reported as inattentive.
 */
export function nextPeerAttention(
  prev: PeerAttention | undefined,
  sample: AttentionPresence | null,
  thresholds: AttentionThresholds,
  now: number,
): PeerAttention {
  if (!sample) {
    return {
      state: 'attentive',
      sinceMs: now,
      activity: prev?.activity ?? 0,
      activeAtMs: now,
      away: null,
      awayAtMs: null,
    };
  }

  // A first sighting starts both clocks now: we have no evidence about how long
  // this peer was already idle, and guessing would alert the moment they join.
  const activeAtMs =
    prev && sample.activity === prev.activity ? prev.activeAtMs : now;
  // Switching between hidden and unfocused is still one continuous absence, so
  // only a return to frontmost restarts the clock.
  const awayAtMs = sample.away === null ? null : (prev?.awayAtMs ?? now);

  const awayFor = awayAtMs === null ? 0 : now - awayAtMs;
  const idleFor = now - activeAtMs;

  // Away outranks idle: both hold while someone is in another window, and
  // "switched away" is the more specific thing to tell the tutor.
  let state: AttentionState = 'attentive';
  let sinceMs = activeAtMs;
  if (awayAtMs !== null && awayFor >= thresholds.awaySeconds * 1_000) {
    state = 'away';
    sinceMs = awayAtMs;
  } else if (idleFor >= thresholds.idleSeconds * 1_000) {
    // Not gated on being frontmost: a short tab-out that has not yet reached the
    // away threshold must not momentarily promote a long-idle peer back to
    // attentive. Input has stopped either way, so the idle clock still holds.
    state = 'idle';
  }

  return {
    state,
    sinceMs,
    activity: sample.activity,
    activeAtMs,
    away: sample.away,
    awayAtMs,
  };
}

/**
 * Whether this transition should raise a toast — once per episode, re-arming
 * only after the peer comes back. Same shape as `nextHighLatencyEpisode`.
 */
export function shouldNotifyAttention(
  previous: AttentionState,
  next: AttentionState,
): boolean {
  return next !== 'attentive' && next !== previous;
}

/**
 * Read an `attention` awareness field. Awareness carries whatever a peer's
 * client chose to put there, so an unrecognised shape reads as "no signal"
 * rather than as inattention.
 */
export function parseAttentionPresence(
  value: unknown,
): AttentionPresence | null {
  if (typeof value !== 'object' || value === null) return null;
  const { activity, away } = value as Partial<AttentionPresence>;
  if (typeof activity !== 'number' || !Number.isFinite(activity)) return null;
  if (away !== null && away !== 'hidden' && away !== 'unfocused') return null;
  return { activity, away };
}

/** Compact duration for the menu readouts and the toast copy. */
export function formatAttentionDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
}
