import { describe, expect, it } from 'vitest';
import { fingerDraws, isFingerTap, multiTouchTapAction } from './touch-input';

describe('fingerDraws', () => {
  it('honours an explicit choice whatever the hardware', () => {
    expect(fingerDraws('draw', true)).toBe(true);
    expect(fingerDraws('draw', false)).toBe(true);
    expect(fingerDraws('pan', true)).toBe(false);
    expect(fingerDraws('pan', false)).toBe(false);
  });

  it('draws by default until a pen turns up', () => {
    expect(fingerDraws('auto', false)).toBe(true);
    expect(fingerDraws('auto', true)).toBe(false);
  });
});

describe('isFingerTap', () => {
  const start = { x: 100, y: 100, t: 0 };

  it('accepts a press that stays put and lifts promptly', () => {
    expect(isFingerTap(start, { x: 103, y: 97, t: 120 })).toBe(true);
  });

  it('rejects a press that travelled', () => {
    expect(isFingerTap(start, { x: 140, y: 100, t: 120 })).toBe(false);
  });

  it('rejects a press that was held', () => {
    expect(isFingerTap(start, { x: 100, y: 100, t: 400 })).toBe(false);
  });
});

describe('multiTouchTapAction', () => {
  it('reads two fingers as undo and three as redo', () => {
    expect(multiTouchTapAction(2, 120, false)).toBe('undo');
    expect(multiTouchTapAction(3, 120, false)).toBe('redo');
    expect(multiTouchTapAction(4, 120, false)).toBe('redo');
  });

  it('ignores one finger, which the tool or the pan already owns', () => {
    expect(multiTouchTapAction(1, 120, false)).toBe(null);
  });

  it('ignores a gesture that moved the board', () => {
    expect(multiTouchTapAction(2, 120, true)).toBe(null);
  });

  it('ignores a hand resting on the glass', () => {
    expect(multiTouchTapAction(2, 900, false)).toBe(null);
  });
});
