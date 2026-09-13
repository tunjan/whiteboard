/**
 * What one finger on the glass does.
 *
 * On a tablet the finger has two jobs that cannot both be the default: it is
 * the only pointer a user without a stylus has, and it is the hand resting on
 * the board while the stylus writes. `penActive` palm rejection in `Canvas.tsx`
 * covers the second only while the pen is actually down — the finger that
 * lands a moment before the nib still draws.
 *
 * So the choice is a preference rather than a detection:
 *
 *  - `draw` — the finger drives the active tool. What every pointer has always
 *    done here, and the only workable default on a tablet with no stylus.
 *  - `pan` — the finger pans and pinches the board; only a pen or a mouse
 *    draws. The mode a Pencil user wants: the hand can rest anywhere, and
 *    navigating never means switching tools first.
 *  - `auto` — `draw` until a pen has been used on this device, then `pan`.
 *    The Pencil is the evidence: someone who has one wants their palm ignored,
 *    and someone who does not never leaves the default.
 */
export type FingerAction = 'draw' | 'pan' | 'auto';

export const FINGER_ACTIONS: readonly FingerAction[] = ['auto', 'draw', 'pan'];

/**
 * Whether a finger should drive the active tool, given the preference and
 * whether a pen has ever been seen on this device.
 */
export function fingerDraws(action: FingerAction, penSeen: boolean): boolean {
  if (action === 'draw') return true;
  if (action === 'pan') return false;
  return !penSeen;
}

/**
 * A finger that pans still has to be able to *point* — otherwise nothing on
 * the board can be selected, no comment pin can be dropped and no sticker
 * stamped without first reaching for the stylus. So a press that pans nowhere
 * and lifts promptly is replayed to the active tool as a tap.
 *
 * The slop is wider than a mouse click's because a finger rolls as it lifts,
 * and the window is short because anything longer is already the long press
 * that opens the context menu (500 ms).
 */
export const FINGER_TAP_SLOP = 10;
export const FINGER_TAP_MS = 350;

/** Whether a press that started at `start` and lifted at `end` was a tap. */
export function isFingerTap(
  start: { x: number; y: number; t: number },
  end: { x: number; y: number; t: number },
): boolean {
  return (
    end.t - start.t < FINGER_TAP_MS &&
    Math.hypot(end.x - start.x, end.y - start.y) < FINGER_TAP_SLOP
  );
}

/**
 * Two fingers tapped means undo, three means redo — the gesture every drawing
 * app on an iPad already has, and the only way to reach undo without lifting a
 * hand off the board for the corner HUD.
 *
 * A tap here is a pinch that never became one: the pan/zoom state machine has
 * its own deadband, so fingers that put down and lift again without crossing
 * it have moved nothing and are unambiguous. The window is short because
 * anything longer is a hand resting on the glass, and resting is not a command.
 */
export const MULTI_TOUCH_TAP_MS = 300;

export function multiTouchTapAction(
  fingers: number,
  durationMs: number,
  moved: boolean,
): 'undo' | 'redo' | null {
  if (moved || durationMs > MULTI_TOUCH_TAP_MS) return null;
  if (fingers === 2) return 'undo';
  return fingers >= 3 ? 'redo' : null;
}
