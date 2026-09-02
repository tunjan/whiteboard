import { describe, expect, it } from 'vitest';
import {
  nextPeerAttention,
  shouldNotifyAttention,
  type AttentionThresholds,
  type PeerAttention,
} from './attention-state';

const THRESHOLDS: AttentionThresholds = { idleSeconds: 90, awaySeconds: 15 };

/** Feed a peer's samples in order, one per `[atMs, sample]` pair. */
function fold(
  steps: [
    number,
    { activity: number; away: 'hidden' | 'unfocused' | null } | null,
  ][],
): PeerAttention {
  let state: PeerAttention | undefined;
  for (const [atMs, sample] of steps) {
    state = nextPeerAttention(state, sample, THRESHOLDS, atMs);
  }
  return state!;
}

describe('nextPeerAttention', () => {
  it('treats a peer as attentive until the idle threshold passes', () => {
    const present = { activity: 1, away: null } as const;
    expect(
      fold([
        [0, present],
        [89_000, present],
      ]).state,
    ).toBe('attentive');
    expect(
      fold([
        [0, present],
        [90_000, present],
      ]).state,
    ).toBe('idle');
  });

  it('clears idle when the activity counter bumps', () => {
    const back = fold([
      [0, { activity: 1, away: null }],
      [95_000, { activity: 1, away: null }],
      [96_000, { activity: 2, away: null }],
    ]);
    expect(back.state).toBe('attentive');
    expect(back.sinceMs).toBe(96_000);
  });

  it('counts idle from the last input, not from crossing the threshold', () => {
    const idle = fold([
      [10_000, { activity: 1, away: null }],
      [110_000, { activity: 1, away: null }],
    ]);
    expect(idle.state).toBe('idle');
    expect(idle.sinceMs).toBe(10_000);
  });

  it('reports away only after the away threshold, then outranks idle', () => {
    const steps: [number, { activity: number; away: 'hidden' | null }][] = [
      [0, { activity: 1, away: null }],
      [1_000, { activity: 1, away: 'hidden' }],
    ];
    expect(
      fold([...steps, [15_000, { activity: 1, away: 'hidden' }]]).state,
    ).toBe('attentive');
    const away = fold([...steps, [16_000, { activity: 1, away: 'hidden' }]]);
    expect(away.state).toBe('away');
    expect(away.sinceMs).toBe(1_000);
    // Still away well past the idle threshold, rather than downgrading to idle.
    expect(
      fold([...steps, [200_000, { activity: 1, away: 'hidden' }]]).state,
    ).toBe('away');
  });

  it('keeps a long-idle peer idle during a tab-out below the away threshold', () => {
    const blip = fold([
      [0, { activity: 1, away: null }],
      [200_000, { activity: 1, away: null }],
      [201_000, { activity: 1, away: 'unfocused' }],
    ]);
    expect(blip.state).toBe('idle');
  });

  it('treats hidden and unfocused as one continuous absence', () => {
    const away = fold([
      [0, { activity: 1, away: null }],
      [1_000, { activity: 1, away: 'unfocused' }],
      [10_000, { activity: 1, away: 'hidden' }],
      [16_000, { activity: 1, away: 'hidden' }],
    ]);
    expect(away.state).toBe('away');
    expect(away.sinceMs).toBe(1_000);
  });

  it('clears away as soon as the peer is frontmost again', () => {
    const back = fold([
      [0, { activity: 1, away: null }],
      [1_000, { activity: 1, away: 'hidden' }],
      [60_000, { activity: 1, away: 'hidden' }],
      [61_000, { activity: 2, away: null }],
    ]);
    expect(back.state).toBe('attentive');
    expect(back.awayAtMs).toBeNull();
  });

  it('never reports a peer that publishes no attention field', () => {
    expect(
      fold([
        [0, null],
        [500_000, null],
      ]).state,
    ).toBe('attentive');
  });

  it('starts a newly seen peer attentive rather than back-dating its silence', () => {
    const first = nextPeerAttention(
      undefined,
      { activity: 7, away: null },
      THRESHOLDS,
      500_000,
    );
    expect(first.state).toBe('attentive');
    expect(first.activeAtMs).toBe(500_000);
  });
});

describe('shouldNotifyAttention', () => {
  it('notifies once when an episode starts', () => {
    expect(shouldNotifyAttention('attentive', 'idle')).toBe(true);
    expect(shouldNotifyAttention('idle', 'idle')).toBe(false);
  });

  it('notifies again when idle escalates to away', () => {
    expect(shouldNotifyAttention('idle', 'away')).toBe(true);
  });

  it('stays quiet on the way back', () => {
    expect(shouldNotifyAttention('away', 'attentive')).toBe(false);
  });
});
