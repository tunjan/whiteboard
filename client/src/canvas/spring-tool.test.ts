import { describe, expect, it } from 'vitest';
import { springReturnTool, type SpringHold } from './spring-tool';

const HOLD_MS = 250;

function held(overrides: Partial<SpringHold> = {}): SpringHold {
  return {
    key: 'e',
    from: 'draw',
    to: 'eraser',
    at: 1000,
    used: false,
    ...overrides,
  };
}

describe('spring-loaded tool hotkeys', () => {
  it('keeps the tool when the key was tapped and nothing was drawn', () => {
    expect(
      springReturnTool(held(), { key: 'e', timeStamp: 1080 }, 'eraser', HOLD_MS),
    ).toBeNull();
  });

  it('gives the tool back when the key was held', () => {
    expect(
      springReturnTool(held(), { key: 'e', timeStamp: 1400 }, 'eraser', HOLD_MS),
    ).toBe('draw');
  });

  it('gives it back on any press the hand actually used, however brief', () => {
    expect(
      springReturnTool(
        held({ used: true }),
        { key: 'e', timeStamp: 1010 },
        'eraser',
        HOLD_MS,
      ),
    ).toBe('draw');
  });

  it('ignores the release of some other key', () => {
    expect(
      springReturnTool(held(), { key: 'r', timeStamp: 1400 }, 'eraser', HOLD_MS),
    ).toBeNull();
  });

  it('matches the release whatever case a held modifier reports it in', () => {
    expect(
      springReturnTool(held(), { key: 'E', timeStamp: 1400 }, 'eraser', HOLD_MS),
    ).toBe('draw');
  });

  it('stays put when the tool was already left behind another way', () => {
    // Escape, the toolbar, or a creation tool completing moved on while the key
    // was down; there is no borrowed tool left to return.
    expect(
      springReturnTool(held(), { key: 'e', timeStamp: 1400 }, 'select', HOLD_MS),
    ).toBeNull();
  });

  it('does nothing when no key is holding a tool', () => {
    expect(
      springReturnTool(null, { key: 'e', timeStamp: 1400 }, 'eraser', HOLD_MS),
    ).toBeNull();
  });
});
