import { describe, expect, it } from 'vitest';
import { nextHighLatencyEpisode } from './high-latency';

describe('nextHighLatencyEpisode', () => {
  it('starts an episode only above 1000 ms', () => {
    expect(nextHighLatencyEpisode(false, 1_000)).toEqual({
      active: false,
      shouldNotify: false,
    });
    expect(nextHighLatencyEpisode(false, 1_001)).toEqual({
      active: true,
      shouldNotify: true,
    });
  });

  it('does not notify again while the episode remains active', () => {
    expect(nextHighLatencyEpisode(true, 1_500)).toEqual({
      active: true,
      shouldNotify: false,
    });
  });

  it('re-arms after latency recovers', () => {
    const recovered = nextHighLatencyEpisode(true, 1_000);
    expect(recovered).toEqual({ active: false, shouldNotify: false });
    expect(nextHighLatencyEpisode(recovered.active, 1_200)).toEqual({
      active: true,
      shouldNotify: true,
    });
  });

  it('re-arms after latency resets during a disconnect', () => {
    const disconnected = nextHighLatencyEpisode(true, null);
    expect(disconnected).toEqual({ active: false, shouldNotify: false });
    expect(nextHighLatencyEpisode(disconnected.active, 1_200)).toEqual({
      active: true,
      shouldNotify: true,
    });
  });
});
