import { beforeEach, describe, expect, it } from 'vitest';
import { usePenPresetsStore } from './use-pen-presets-store';

describe('usePenPresetsStore', () => {
  beforeEach(() => {
    usePenPresetsStore.setState({
      presets: [
        { color: '#274001', size: 4 },
        { color: '#f25c05', size: 4 },
        { color: '#2563eb', size: 8 },
      ],
      activeIndex: 0,
    });
  });

  it('defaults to 3 presets', () => {
    const { presets } = usePenPresetsStore.getState();
    expect(presets).toHaveLength(3);
  });

  it('setActive switches the active preset index', () => {
    usePenPresetsStore.getState().setActive(2);
    expect(usePenPresetsStore.getState().activeIndex).toBe(2);
  });

  it('updateActive patches only the active preset', () => {
    usePenPresetsStore.getState().setActive(1);
    usePenPresetsStore.getState().updateActive({ color: '#ffffff' });

    const { presets } = usePenPresetsStore.getState();
    expect(presets[1]).toEqual({ color: '#ffffff', size: 4 });
    expect(presets[0]).toEqual({ color: '#274001', size: 4 });
    expect(presets[2]).toEqual({ color: '#2563eb', size: 8 });
  });
});
