import { describe, expect, it } from 'vitest';
import {
  MAX_VOICE_LEVEL_DB,
  MIN_VOICE_LEVEL_DB,
  clampGateThreshold,
  clampVoiceLevel,
  voiceLevelPercent,
} from './voice-gate';

describe('voice gate values', () => {
  it('clamps adjustable thresholds to the supported decibel range', () => {
    expect(clampGateThreshold(-80)).toBe(MIN_VOICE_LEVEL_DB);
    expect(clampGateThreshold(-42.6)).toBe(-43);
    expect(clampGateThreshold(0)).toBe(MAX_VOICE_LEVEL_DB);
  });

  it('normalises microphone levels for the visual meter', () => {
    expect(voiceLevelPercent(-60)).toBe(0);
    expect(voiceLevelPercent(-35)).toBe(50);
    expect(voiceLevelPercent(-10)).toBe(100);
    expect(voiceLevelPercent(clampVoiceLevel(Number.NaN))).toBe(0);
  });
});
