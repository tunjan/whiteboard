import { describe, expect, it } from 'vitest';
import { micConstraints } from './mic';

describe('micConstraints', () => {
  it('keeps echo cancellation and automatic gain enabled', () => {
    expect(micConstraints(true)).toEqual({
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: true,
    });
    expect(micConstraints(false)).toEqual({
      echoCancellation: true,
      autoGainControl: true,
      noiseSuppression: false,
    });
  });
});
