import { setLocalAttention } from './presence';
import type { AwayReason } from './attention-state';

// One awareness update a second while someone is drawing, against the cursor
// field's 25 Hz. The counter only has to prove that input happened, not when.
const ACTIVITY_THROTTLE_MS = 1_000;

let running = false;
let activity = 0;
let lastBumpAt = 0;
let away: AwayReason | null = null;

function publish(): void {
  setLocalAttention(running ? { activity, away } : null);
}

/**
 * Record local input. Called from the canvas's pointer, key and wheel funnels
 * and from every local document transaction; a no-op with no board loaded, so
 * callers never have to check.
 */
export function noteActivity(): void {
  if (!running) return;
  const now = performance.now();
  if (now - lastBumpAt < ACTIVITY_THROTTLE_MS) return;
  lastBumpAt = now;
  activity += 1;
  publish();
}

// `document.hasFocus()` rather than the blur event itself: it stays true when
// focus moves into an iframe on the page, so an embedded player does not read
// as the person leaving.
function currentAway(): AwayReason | null {
  if (document.visibilityState === 'hidden') return 'hidden';
  return document.hasFocus() ? null : 'unfocused';
}

function syncAway(): void {
  const next = currentAway();
  if (next === away) return;
  away = next;
  if (next === null) {
    // Coming back is itself a deliberate act, so it restarts the idle clock.
    // Without this, someone who returns after a long absence is reported idle
    // the instant they arrive — a second alert at the worst possible moment.
    lastBumpAt = performance.now();
    activity += 1;
  }
  publish();
}

// A blur can be reported before the document actually gives up focus, so the
// check is deferred by a task. Safe against background throttling: a blur that
// comes from the tab being hidden is caught synchronously by visibilitychange.
function onBlur(): void {
  setTimeout(syncAway, 0);
}

/**
 * Publish this client's own attention facts for as long as a board is open.
 * Mirrors `startLatencyMonitor`: start it from `loadBoard`, call the returned
 * disposer from the session cleanup.
 *
 * There is no heartbeat. Peers time the gaps between changes themselves, which
 * is what lets this keep working after the browser freezes a hidden tab's
 * timers — the transition out was published before the freeze, and it stands.
 */
export function startAttentionMonitor(): () => void {
  running = true;
  activity = 0;
  lastBumpAt = 0;
  away = currentAway();
  publish();

  document.addEventListener('visibilitychange', syncAway);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', syncAway);

  return () => {
    document.removeEventListener('visibilitychange', syncAway);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', syncAway);
    running = false;
    away = null;
    publish();
  };
}
